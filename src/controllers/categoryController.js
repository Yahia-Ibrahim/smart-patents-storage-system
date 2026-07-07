exports.createCategory = async (req, res, next) => {
  try {
    res.status(201).json({ message: 'createCategory not implemented yet' });
  } catch (error) {
    next(error);
  }
};

exports.getAllCategories = async (_req, res, next) => {
  try {
    res.status(200).json({ message: 'getAllCategories not implemented yet' });
  } catch (error) {
    next(error);
  }
};

exports.getCategoryById = async (req, res, next) => {
  try {
    res.status(200).json({ message: 'getCategoryById not implemented yet', id: req.params.id });
  } catch (error) {
    next(error);
  }
};

exports.updateCategory = async (req, res, next) => {
  try {
    res.status(200).json({ message: 'updateCategory not implemented yet', id: req.params.id });
  } catch (error) {
    next(error);
  }
};

exports.deleteCategory = async (req, res, next) => {
  try {
    res.status(200).json({ message: 'deleteCategory not implemented yet', id: req.params.id });
  } catch (error) {
    next(error);
  }
};
