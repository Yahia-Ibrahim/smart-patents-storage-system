const categoryService = require('../services/categoryService');
const { sendSuccess } = require('../utils/response');
const { toCategoryDto } = require('../utils/dto');

exports.createCategory = async (req, res, next) => {
  try {
    const category = await categoryService.createCategory({ name: req.body.name });

    sendSuccess(res, 201, toCategoryDto(category));
  } catch (error) {
    next(error);
  }
};

exports.getAllCategories = async (req, res, next) => {
  try {
    const categories = await categoryService.listCategories({ search: req.query.search });

    sendSuccess(res, 200, { categories: categories.map(toCategoryDto) });
  } catch (error) {
    next(error);
  }
};

exports.getCategoryById = async (req, res, next) => {
  try {
    const category = await categoryService.getCategoryById(BigInt(req.params.id));

    sendSuccess(res, 200, toCategoryDto(category));
  } catch (error) {
    next(error);
  }
};

exports.updateCategory = async (req, res, next) => {
  try {
    const category = await categoryService.updateCategory(BigInt(req.params.id), {
      name: req.body.name,
    });

    sendSuccess(res, 200, toCategoryDto(category));
  } catch (error) {
    next(error);
  }
};

exports.deleteCategory = async (req, res, next) => {
  try {
    await categoryService.deleteCategory(BigInt(req.params.id));

    sendSuccess(res, 200, { message: 'Category deleted' });
  } catch (error) {
    next(error);
  }
};
