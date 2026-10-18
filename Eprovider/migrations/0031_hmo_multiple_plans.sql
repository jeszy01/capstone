-- HMO Plan tab lists several plans; more than one may be Active. Each enrollment keeps its own plan_id.
drop index if exists uq_hmo_one_active_plan;
