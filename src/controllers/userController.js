exports.createUser = async (req, res, next) => {
  try {
    res.status(201).json({ message: 'createUser not implemented yet' });
  } catch (error) {
    next(error);
  }
};

exports.getAllUsers = async (_req, res, next) => {
  try {
    res.status(200).json({ message: 'getAllUsers not implemented yet' });
  } catch (error) {
    next(error);
  }
};

exports.getUserById = async (req, res, next) => {
  try {
    res.status(200).json({ message: 'getUserById not implemented yet', id: req.params.id });
  } catch (error) {
    next(error);
  }
};

exports.updateUser = async (req, res, next) => {
  try {
    res.status(200).json({ message: 'updateUser not implemented yet', id: req.params.id });
  } catch (error) {
    next(error);
  }
};

exports.deleteUser = async (req, res, next) => {
  try {
    res.status(200).json({ message: 'deleteUser not implemented yet', id: req.params.id });
  } catch (error) {
    next(error);
  }
};
