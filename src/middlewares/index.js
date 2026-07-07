exports.notFound = (req, res, next) => {
  res.status(404).json({ message: 'Route not found' });
};

exports.errorHandler = (err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({
    message: err.message || 'Internal Server Error'
  });
};
