ALTER TABLE app.planning_requests ADD COLUMN thread_id uuid,
 ADD FOREIGN KEY(organization_id,brand_id,thread_id) REFERENCES app.canvas_threads(organization_id,brand_id,id);
CREATE INDEX planning_thread_history ON app.planning_requests(thread_id) WHERE thread_id IS NOT NULL;
CREATE POLICY planning_message_insert ON app.canvas_messages FOR INSERT TO desvio_worker WITH CHECK(app.planning_scope(organization_id,brand_id) AND job_id=app.job_context() AND role='assistant' AND EXISTS(SELECT 1 FROM app.planning_requests r WHERE r.job_id=app.job_context() AND r.thread_id=canvas_messages.thread_id));
