"""Authoritative machining service and its independently paced WebSocket snapshots."""
from __future__ import annotations

import asyncio
from contextlib import suppress
from typing import Literal

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, ConfigDict, Field

from domain_machining.comparison import compare_policies
from domain_machining.config import OrderConfig, Policy, WorkshopConfig
from domain_machining.engine import MachiningEngine
from .guard import WS_SEND_TIMEOUT_S, client_key, origin_allowed, request_host, ws_registry


class Request(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True, allow_inf_nan=False)


class ControlRequest(Request):
    paused: bool | None = None
    speed: float | None = Field(default=None, ge=.1, le=100)
    advance_seconds: float | None = Field(default=None, ge=0, le=7200)


class FaultRequest(Request):
    machine_id: Literal['L01', 'L02', 'L03', 'M01', 'M02', 'M03']
    duration_seconds: float = Field(gt=0, le=7200)
    active: bool


class CompareRequest(Request):
    horizon_seconds: float = Field(gt=0, le=7200)


class ApplyRequest(Request):
    policy: Policy
    run_id: str = Field(min_length=1, max_length=80)
    revision: int = Field(ge=0)


class History(BaseModel):
    time: float
    event: str
    resource: str


class Part(BaseModel):
    id: str
    order_id: str
    part_type: Literal['shaft', 'sleeve']
    operation: str
    stage_index: int
    status: str
    location: str
    position: list[float]
    waiting_reason: str | None
    history: list[History]
    assigned_machine: str | None


class Order(OrderConfig):
    completed: int
    status: str
    projected_finish: float | None
    tardiness: float
    affected: bool


class Machine(BaseModel):
    id: str
    operation: str
    status: Literal['idle', 'setup', 'running', 'fault', 'blocked', 'waiting']
    part_id: str | None
    progress: float
    queue: list[str]
    fault_remaining: float
    incoming: list[str]
    output: list[str]


class Robot(BaseModel):
    id: str
    position: list[float]
    status: str
    machine_id: str | None
    part_id: str | None
    tip: list[float] | None
    utilization: float


class AMR(BaseModel):
    id: str
    position: list[float]
    heading: float
    status: str
    part_id: str | None
    from_id: str | None
    to_id: str | None
    completed_trips: int
    path: list[list[float]]


class Metrics(BaseModel):
    completed_parts: int
    total_parts: int
    wip: int
    waiting_seconds: float
    on_time_orders: int
    tardy_seconds: float
    robot_utilization: dict[str, float]


class Bottleneck(BaseModel):
    resource: str
    reason: str
    waiting_parts: int
    order_ids: list[str]


class Event(BaseModel):
    seq: int
    time: float
    kind: str
    resource: str
    part_id: str | None
    message: str


class Snapshot(BaseModel):
    run_id: str
    revision: int
    elapsed: float
    paused: bool
    speed: float
    policy: Policy
    complete: bool
    orders: list[Order]
    parts: list[Part]
    machines: list[Machine]
    robots: list[Robot]
    amrs: list[AMR]
    metrics: Metrics
    bottlenecks: list[Bottleneck]
    events: list[Event]
    assumptions: list[str]


class Scenario(BaseModel):
    policy: Policy
    metrics: Metrics
    orders: list[Order]
    complete: bool
    elapsed: float
    explanation: str


class Comparison(BaseModel):
    run_id: str
    revision: int
    state_hash: str
    horizon_seconds: float
    scenarios: list[Scenario]


class WorkshopService:
    def __init__(self):
        self.engine = MachiningEngine()
        self.lock = asyncio.Lock()
        self.comparison_busy = False

    def snapshot(self):
        return Snapshot.model_validate(self.engine.snapshot()).model_dump(mode='json')

    async def ticker(self):
        while True:
            await asyncio.sleep(.2)
            async with self.lock:
                if not self.engine.paused and not self.engine.complete:
                    self.engine.advance(.2 * self.engine.speed)


service = WorkshopService()
router = APIRouter()


@router.get('/api/workshop/config', response_model=WorkshopConfig)
async def config():
    async with service.lock:
        return service.engine.config


@router.get('/api/workshop/snapshot', response_model=Snapshot)
async def snapshot():
    async with service.lock:
        return service.snapshot()


@router.post('/api/workshop/reset', response_model=Snapshot)
async def reset(payload: WorkshopConfig | None = None):
    async with service.lock:
        service.engine = MachiningEngine(payload or WorkshopConfig())
        return service.snapshot()


@router.post('/api/workshop/control', response_model=Snapshot)
async def control(payload: ControlRequest):
    async with service.lock:
        engine = service.engine
        if payload.paused is not None:
            engine.paused = payload.paused
        if payload.speed is not None:
            engine.speed = payload.speed
        if payload.advance_seconds is not None:
            # Long explicit advances must not stop the legacy factory's event loop.
            if payload.advance_seconds > 20:
                await asyncio.to_thread(engine.advance, payload.advance_seconds)
            else:
                engine.advance(payload.advance_seconds)
        engine.revision += 1
        return service.snapshot()


@router.post('/api/workshop/fault', response_model=Snapshot)
async def fault(payload: FaultRequest):
    async with service.lock:
        service.engine.set_fault(payload.machine_id, payload.duration_seconds, payload.active)
        return service.snapshot()


@router.post('/api/workshop/compare', response_model=Comparison)
async def compare(payload: CompareRequest):
    async with service.lock:
        if service.comparison_busy:
            raise HTTPException(409, 'A workshop comparison is already running')
        service.comparison_busy = True
        branch = MachiningEngine.from_state(service.engine.dump_state())
    try:
        return await asyncio.to_thread(compare_policies, branch, payload.horizon_seconds)
    finally:
        service.comparison_busy = False


@router.post('/api/workshop/apply', response_model=Snapshot)
async def apply(payload: ApplyRequest):
    async with service.lock:
        engine = service.engine
        if engine.run_id != payload.run_id or engine.revision != payload.revision:
            raise HTTPException(409, 'Workshop state changed; pause and compare again before applying')
        engine.set_policy(payload.policy)
        return service.snapshot()


@router.websocket('/ws/workshop')
async def websocket(ws: WebSocket):
    headers = dict(ws.headers)
    if not origin_allowed(headers.get('origin'), request_host(headers), headers.get('sec-fetch-site')):
        await ws.close(code=1008, reason='origin not allowed')
        return
    key = client_key(headers, ws.client.host if ws.client else None)
    why = ws_registry.try_add(key)
    if why:
        await ws.close(code=1013, reason=why)
        return
    async def receive():
        # No upstream commands; consuming messages lets disconnects release capacity promptly.
        while True:
            message = await ws.receive()
            if message['type'] == 'websocket.disconnect':
                return
            if len(message.get('text', '').encode()) + len(message.get('bytes', b'')) > 4096:
                await ws.close(code=1009, reason='message too big')
                return
    receiver = None
    try:
        await ws.accept()
        receiver = asyncio.create_task(receive())
        while not receiver.done():
            async with service.lock:
                payload = service.snapshot()
            if WS_SEND_TIMEOUT_S <= 0:
                await ws.send_json(payload)
            else:
                async with asyncio.timeout(WS_SEND_TIMEOUT_S):
                    await ws.send_json(payload)
            await asyncio.sleep(.2)
    except (WebSocketDisconnect, RuntimeError, TimeoutError):
        pass
    finally:
        if receiver is not None:
            receiver.cancel()
            with suppress(asyncio.CancelledError, WebSocketDisconnect, RuntimeError):
                await receiver
        ws_registry.remove(key)
