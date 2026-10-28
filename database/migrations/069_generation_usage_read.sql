-- Account members can read their own balance; assignment and usage writes
-- remain operator/trigger-only. No provider call detail is exposed here.
GRANT SELECT ON app.generation_plans,app.monthly_generation_usage TO desvio_app;
CREATE POLICY member_generation_plan_read ON app.generation_plans FOR SELECT TO desvio_app
 USING(app.can_access(organization_id,false));
CREATE POLICY member_generation_usage_read ON app.monthly_generation_usage FOR SELECT TO desvio_app
 USING(app.can_access(organization_id,false));
