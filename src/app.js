const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const routes = require('./routes');
const { notFound, errorHandler } = require('./middlewares');
const { setupSwagger } = require('./swagger');

const validateRequest = (validator) => (req, res, next) => {
  const errors = validator(req.body, req.query);

  if (errors && errors.length > 0) {
    return res.status(400).json({ errors });
  }

  next();
};

const app = express();

app.use(cors());
app.use(helmet());
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use((req, _res, next) => {
  req.validate = (validator) => validateRequest(validator);
  next();
});

if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.use('/api', routes);
setupSwagger(app);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
