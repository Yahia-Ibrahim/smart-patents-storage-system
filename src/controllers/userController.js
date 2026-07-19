const userService = require('../services/userService');
const { sendSuccess } = require('../utils/response');
const { toUserDto, toAdminUserDto, toProfileDto } = require('../utils/dto');

/**
 * Controllers stay thin on purpose: unwrap the request, call the service, map
 * the result to a DTO. No business rules, no Prisma. Anything with a decision
 * in it belongs in services/userService.js.
 */

exports.signupUser = async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    const { user, tokens } = await userService.signupUser({ name, email, password });

    sendSuccess(res, 201, { user: toUserDto(user), ...tokens });
  } catch (error) {
    next(error);
  }
};

exports.loginUser = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const { user, tokens } = await userService.loginUser({ email, password });

    sendSuccess(res, 200, { user: toUserDto(user), ...tokens });
  } catch (error) {
    next(error);
  }
};

exports.refreshSession = async (req, res, next) => {
  try {
    const { user, tokens } = await userService.refreshSession(req.body.refreshToken);

    sendSuccess(res, 200, { user: toUserDto(user), ...tokens });
  } catch (error) {
    next(error);
  }
};

exports.logoutUser = async (req, res, next) => {
  try {
    await userService.logoutUser({
      userId: req.user.userId,
      refreshToken: req.body.refreshToken,
    });

    sendSuccess(res, 200, { message: 'Logged out' });
  } catch (error) {
    next(error);
  }
};

exports.getMyProfile = async (req, res, next) => {
  try {
    const user = await userService.getProfile(req.user.userId);

    sendSuccess(res, 200, toProfileDto(user));
  } catch (error) {
    next(error);
  }
};

exports.updateMyProfile = async (req, res, next) => {
  try {
    const { name, email } = req.body;
    const user = await userService.updateProfile(req.user.userId, { name, email });

    sendSuccess(res, 200, toProfileDto(user));
  } catch (error) {
    next(error);
  }
};

exports.changeMyPassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    await userService.changePassword(req.user.userId, { currentPassword, newPassword });

    // Every session is revoked by the service, so the client must log in again.
    sendSuccess(res, 200, { message: 'Password changed; please log in again' });
  } catch (error) {
    next(error);
  }
};

exports.createAdmin = async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    const admin = await userService.createAdmin({ name, email, password }, req.user.userId);

    sendSuccess(res, 201, toAdminUserDto(admin));
  } catch (error) {
    next(error);
  }
};

exports.getAllUsers = async (req, res, next) => {
  try {
    const { page, limit, role, search } = req.query;
    const result = await userService.listUsers({ page, limit, role, search });

    sendSuccess(res, 200, {
      users: result.users.map(toAdminUserDto),
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

exports.getUserById = async (req, res, next) => {
  try {
    const user = await userService.getUserById(BigInt(req.params.id));

    sendSuccess(res, 200, toAdminUserDto(user));
  } catch (error) {
    next(error);
  }
};
