const { User } = require('../models');

/**
 * Attach current user to req from session (if logged in).
 * Does not block; use requireAuth for that.
 */
async function attachUser(req, res, next) {
  if (req.session && req.session.userId) {
    try {
      const user = await User.findByPk(req.session.userId, {
        attributes: ['id', 'username', 'display_name', 'auth_source', 'is_admin']
      });
      req.user = user || null;
    } catch (err) {
      req.user = null;
    }
  } else {
    req.user = null;
  }
  next();
}

/**
 * Require authentication. Returns 401 if no session user.
 * Must be used after session and ideally after attachUser so req.user is set.
 */
function requireAuth(req, res, next) {
  if (req.session && req.session.userId && req.user) {
    return next();
  }
  res.status(401).json({ error: 'Authentication required' });
}

module.exports = { attachUser, requireAuth };
