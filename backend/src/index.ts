import { createApp } from './app';
import { getIntegrationStatus } from './config/env';

const { app, env } = createApp();
const status = getIntegrationStatus(env);

app.listen(env.PORT, () => {
  console.log(`[awaaz-backend] Listening on http://localhost:${env.PORT}/api/v1`);
  console.log(`[awaaz-backend] OpenAPI docs: http://localhost:${env.PORT}/api/v1/docs`);
  console.log(
    `[awaaz-backend] Mode: dataStore=${status.dataStoreMode}, auth=${status.authMode}, aiConfigured=${status.ai.configured}, voice=${status.voice.provider}(configured=${status.voice.configured})`,
  );
});
