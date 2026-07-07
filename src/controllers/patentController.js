exports.createPatent = async (req, res, next) => {
  try {
    res.status(201).json({ message: 'createPatent not implemented yet' });
  } catch (error) {
    next(error);
  }
};

exports.getAllPatents = async (_req, res, next) => {
  try {
    res.status(200).json({ message: 'getAllPatents not implemented yet' });
  } catch (error) {
    next(error);
  }
};

exports.getPatentById = async (req, res, next) => {
  try {
    res.status(200).json({ message: 'getPatentById not implemented yet', id: req.params.id });
  } catch (error) {
    next(error);
  }
};

exports.updatePatent = async (req, res, next) => {
  try {
    res.status(200).json({ message: 'updatePatent not implemented yet', id: req.params.id });
  } catch (error) {
    next(error);
  }
};

exports.deletePatent = async (req, res, next) => {
  try {
    res.status(200).json({ message: 'deletePatent not implemented yet', id: req.params.id });
  } catch (error) {
    next(error);
  }
};
