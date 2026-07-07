exports.createInventor = async (req, res, next) => {
  try {
    res.status(201).json({ message: 'createInventor not implemented yet' });
  } catch (error) {
    next(error);
  }
};

exports.getAllInventors = async (_req, res, next) => {
  try {
    res.status(200).json({ message: 'getAllInventors not implemented yet' });
  } catch (error) {
    next(error);
  }
};

exports.getInventorById = async (req, res, next) => {
  try {
    res.status(200).json({ message: 'getInventorById not implemented yet', id: req.params.id });
  } catch (error) {
    next(error);
  }
};

exports.updateInventor = async (req, res, next) => {
  try {
    res.status(200).json({ message: 'updateInventor not implemented yet', id: req.params.id });
  } catch (error) {
    next(error);
  }
};

exports.deleteInventor = async (req, res, next) => {
  try {
    res.status(200).json({ message: 'deleteInventor not implemented yet', id: req.params.id });
  } catch (error) {
    next(error);
  }
};
