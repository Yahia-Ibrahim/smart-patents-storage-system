import 'dotenv/config';
import { defineConfig, env } from '@prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
  },
  migrations: {
    // Prisma 7 reads the seed command from here, not from package.json.
    seed: 'node prisma/seed.js',
  },
});
