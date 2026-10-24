-- Optional owner-confirmed strategy context; not verified product claims.
ALTER TABLE app.business_onboarding
 ADD COLUMN business_stage text NOT NULL DEFAULT '' CHECK(business_stage IN ('','pre_launch','launching','growing','established')),
 ADD COLUMN growth_expectation text NOT NULL DEFAULT '' CHECK(length(growth_expectation)<=600);
GRANT UPDATE(business_stage,growth_expectation) ON app.business_onboarding TO desvio_app;
