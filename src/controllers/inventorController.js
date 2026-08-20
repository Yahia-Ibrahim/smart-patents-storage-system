const inventorService = require('../services/inventorService');
const { sendSuccess } = require('../utils/response');
const { toInventorDetailDto } = require('../utils/dto');

exports.createInventor = async (req, res, next) => {
  try {
    const { fullName, email, organization, linkToMe } = req.body;
    const inventor = await inventorService.createInventor(
      { fullName, email, organization, linkToMe },
      req.user,
    );

    sendSuccess(res, 201, toInventorDetailDto(inventor));
  } catch (error) {
    next(error);
  }
};

exports.getAllInventors = async (req, res, next) => {
  try {
    const result = await inventorService.listInventors(req.query);

    sendSuccess(res, 200, {
      inventors: result.inventors.map(toInventorDetailDto),
      pagination: {
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
      },
    });
  } catch (error) {
    next(error);
  }
};

exports.getInventorById = async (req, res, next) => {
  try {
    const inventor = await inventorService.getInventorById(BigInt(req.params.id));

    sendSuccess(res, 200, toInventorDetailDto(inventor));
  } catch (error) {
    next(error);
  }
};

exports.updateInventor = async (req, res, next) => {
  try {
    const { fullName, email, organization } = req.body;
    const inventor = await inventorService.updateInventor(
      BigInt(req.params.id),
      { fullName, email, organization },
      req.user,
    );

    sendSuccess(res, 200, toInventorDetailDto(inventor));
  } catch (error) {
    next(error);
  }
};

exports.deleteInventor = async (req, res, next) => {
  try {
    await inventorService.deleteInventor(BigInt(req.params.id));

    sendSuccess(res, 200, { message: 'Inventor deleted' });
  } catch (error) {
    next(error);
  }
};
