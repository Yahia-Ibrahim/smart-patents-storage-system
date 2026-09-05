const patentService = require('../services/patentService');
const aiSearchService = require('../services/aiSearchService');
const { sendSuccess } = require('../utils/response');
const {
  toPatentDto,
  toPatentDetailDto,
  toPatentReviewDto,
  toPatentSearchMatchDto,
} = require('../utils/dto');

/**
 * Thin HTTP layer: unwrap the request, call the service, map to a DTO.
 * Every authorization and state-machine decision lives in patentService.
 */

exports.requestUpload = async (req, res, next) => {
  try {
    const { filename, contentType } = req.body;
    const result = await patentService.requestUpload({ filename, contentType }, req.user);

    sendSuccess(res, 201, result);
  } catch (error) {
    next(error);
  }
};

exports.createPatent = async (req, res, next) => {
  try {
    const patent = await patentService.createPatent(req.body, req.user);

    sendSuccess(res, 201, toPatentDetailDto(patent, req.user));
  } catch (error) {
    next(error);
  }
};

exports.listPatents = async (req, res, next) => {
  try {
    const result = await patentService.listPatents(req.query, req.user);

    sendSuccess(res, 200, {
      patents: result.patents.map((patent) => toPatentDto(patent, req.user)),
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

/**
 * Semantic search. The only endpoint that calls the AI service synchronously;
 * everything else between the two systems goes through Kafka.
 */
exports.searchPatents = async (req, res, next) => {
  try {
    const result = await aiSearchService.search(req.body.text, req.user);

    sendSuccess(res, 200, {
      summary: result.summary,
      results: result.matches.map((match) => toPatentSearchMatchDto(match, req.user)),
    });
  } catch (error) {
    next(error);
  }
};

exports.getPatentById = async (req, res, next) => {
  try {
    const patent = await patentService.getPatentById(BigInt(req.params.id), req.user);

    sendSuccess(res, 200, toPatentDetailDto(patent, req.user));
  } catch (error) {
    next(error);
  }
};

exports.updatePatent = async (req, res, next) => {
  try {
    const patent = await patentService.updatePatent(BigInt(req.params.id), req.body, req.user);

    sendSuccess(res, 200, toPatentDetailDto(patent, req.user));
  } catch (error) {
    next(error);
  }
};

exports.submitPatent = async (req, res, next) => {
  try {
    const patent = await patentService.submitForReview(BigInt(req.params.id), req.user);

    sendSuccess(res, 200, toPatentDetailDto(patent, req.user));
  } catch (error) {
    next(error);
  }
};

exports.approvePatent = async (req, res, next) => {
  try {
    const patent = await patentService.approvePatent(
      BigInt(req.params.id),
      { comments: req.body.comments },
      req.user,
    );

    sendSuccess(res, 200, toPatentDetailDto(patent, req.user));
  } catch (error) {
    next(error);
  }
};

exports.declinePatent = async (req, res, next) => {
  try {
    const patent = await patentService.declinePatent(
      BigInt(req.params.id),
      { comments: req.body.comments },
      req.user,
    );

    sendSuccess(res, 200, toPatentDetailDto(patent, req.user));
  } catch (error) {
    next(error);
  }
};

exports.deletePatent = async (req, res, next) => {
  try {
    await patentService.deletePatent(BigInt(req.params.id), req.user);

    sendSuccess(res, 200, { message: 'Patent deleted' });
  } catch (error) {
    next(error);
  }
};

exports.listReviews = async (req, res, next) => {
  try {
    const reviews = await patentService.listReviews(BigInt(req.params.id), req.user);

    sendSuccess(res, 200, { reviews: reviews.map((review) => toPatentReviewDto(review, req.user)) });
  } catch (error) {
    next(error);
  }
};

exports.getDocumentUrl = async (req, res, next) => {
  try {
    const result = await patentService.getDocumentUrl(BigInt(req.params.id), req.user);

    sendSuccess(res, 200, result);
  } catch (error) {
    next(error);
  }
};
