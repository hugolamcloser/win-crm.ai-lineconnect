// Dedicated executable. Never imported by the HTTP server or other channel startup.
import { runEvery8dSettingsEmailWorkerProcess } from "./every8dSettingsEmailWorkerProcess";

if (require.main === module) {
  void runEvery8dSettingsEmailWorkerProcess({
    process,
    loadEnvironment() {
      // Signal/error handlers are installed before dotenv or any operational import.
      require("dotenv").config();
      return process.env;
    },
    createRepository(config) {
      // Importing the existing repository loads shared environment/Supabase modules;
      // keep that import beyond configuration, registry and readiness admission.
      return (require("../services/every8dSettingsEmailOutboxRepository") as
        typeof import("../services/every8dSettingsEmailOutboxRepository"))
        .createEvery8dSettingsEmailOutboxRepository(config);
    },
    telemetry(event) { process.stdout.write(JSON.stringify(event) + "\n"); }
  }).then((result) => {
    process.exitCode = result.exitCode;
    // Only the total drain boundary can abandon hung handles. Durable recovery
    // owns unresolved writes; no operation was declared finished by a watchdog.
    if (result.forceExit) process.exit(result.exitCode);
  }, () => { process.stderr.write('{"component":"settings_email_worker","event":"startup_failed"}\n'); process.exit(1); });
}
