import { RuntimeConfigSchema } from "@reso/config";
import { buildApp } from "./app.js";
import { createAgentClient } from "./agent-client/factory.js";

const config = RuntimeConfigSchema.parse(process.env);
const agentClient = createAgentClient(config.AGENT_PROVIDER, config.AGENT_SERVICE_URL);
const app = await buildApp({ agentClient, logger: true });

await app.listen({ host: "0.0.0.0", port: config.API_PORT });
