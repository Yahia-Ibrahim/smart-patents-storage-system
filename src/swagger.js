let swaggerJsdoc;
let swaggerUi;

try {
  swaggerJsdoc = require('swagger-jsdoc');
  swaggerUi = require('swagger-ui-express');
} catch (_error) {
  swaggerJsdoc = null;
  swaggerUi = null;
}

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Smart Patents Storage System API',
      version: '1.0.0',
      description: 'Swagger documentation for the patent storage and retrieval backend.',
    },
    servers: [
      {
        url: 'http://localhost:5000/api',
        description: 'Local development server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: ['./src/routes/*.js'],
};

const swaggerSpec = swaggerJsdoc ? swaggerJsdoc(options) : null;

const setupSwagger = (app) => {
  if (!swaggerUi || !swaggerSpec) {
    return;
  }

  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
};

module.exports = { setupSwagger, swaggerSpec };
