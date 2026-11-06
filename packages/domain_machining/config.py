"""Validated, deliberately small demonstration parameters; times are simulated seconds."""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Policy = Literal['fifo', 'reroute', 'edd']


class OrderConfig(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True, allow_inf_nan=False)
    id: str = Field(min_length=1, max_length=40, pattern=r'^[A-Za-z0-9_-]+$')
    part_type: Literal['shaft', 'sleeve']
    quantity: int = Field(ge=1, le=40)
    due_seconds: float = Field(gt=0, le=86400)


class WorkshopConfig(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True, allow_inf_nan=False)
    orders: list[OrderConfig] = Field(default_factory=lambda: [
        OrderConfig(id='ORD-001', part_type='shaft', quantity=4, due_seconds=1100),
        OrderConfig(id='ORD-002', part_type='sleeve', quantity=4, due_seconds=800),
        OrderConfig(id='ORD-003', part_type='shaft', quantity=3, due_seconds=1000),
    ], min_length=1, max_length=8)

    @model_validator(mode='after')
    def unique_orders(self):
        if len({o.id for o in self.orders}) != len(self.orders):
            raise ValueError('Order IDs must be unique')
        if sum(o.quantity for o in self.orders) > 80:
            raise ValueError('At most 80 demonstration parts per run')
        return self


POSITIONS = {
    'RAW': [-20., .8, -8.], 'FG': [20., .8, -8.],
    'L01': [-12., 1.1, -8.], 'L02': [-3., 1.1, -8.], 'L03': [6., 1.1, -8.],
    'M01': [-12., 1.1, 8.], 'M02': [-3., 1.1, 8.], 'M03': [6., 1.1, 8.],
    'D01': [14., .9, 8.], 'W01': [20., .9, 8.], 'Q01': [13., .9, -8.],
}
OPERATIONS = {'L01': 'turning', 'L02': 'turning', 'L03': 'turning',
              'M01': 'milling', 'M02': 'milling', 'M03': 'milling',
              'D01': 'deburr', 'W01': 'wash', 'Q01': 'inspection'}
STAGES = {'turning': 1, 'milling': 2, 'deburr': 3, 'wash': 4, 'inspection': 5, 'finished': 6}
ROUTES = {'shaft': ['turning', 'milling', 'deburr', 'wash', 'inspection'],
          'sleeve': ['turning', 'deburr', 'wash', 'inspection']}
DURATIONS = {'shaft': {'turning': 32., 'milling': 38., 'deburr': 10., 'wash': 12., 'inspection': 10.},
             'sleeve': {'turning': 24., 'deburr': 8., 'wash': 12., 'inspection': 10.}}
# L03 has no sleeve chuck; M03's fixture is reserved for shafts.
COMPATIBILITY = {mid: (['shaft'] if mid in ('L03', 'M03') else ['shaft', 'sleeve']) for mid in OPERATIONS}
QUEUE_CAPACITY = 2
SETUP_SECONDS = 8.
