/**
 * @openapi
 * components:
 *   schemas:
 *     AuthUserPayload:
 *       type: object
 *       description: Also includes the preference fields returned by prefsPayload().
 *       additionalProperties: true
 *       properties:
 *         id: { type: string, example: 665f1c2e9b1e8a0012a4b123 }
 *         fullName: { type: string, example: Jane Doe }
 *         email: { type: string, example: jane@example.com }
 *         avatar: { type: string, example: "https://res.cloudinary.com/.../avatar.jpg" }
 *         token:
 *           type: object
 *           properties:
 *             accessToken: { type: string }
 *             refreshToken: { type: string }
 *     TwoFactorChallenge:
 *       type: object
 *       properties:
 *         twoFactorRequired: { type: boolean, example: true }
 *         challengeToken: { type: string }
 *     RecoveryCodesResult:
 *       type: object
 *       properties:
 *         recoveryCodes:
 *           type: array
 *           items: { type: string }
 *         warning: { type: string }
 *
 * /auth/register:
 *   post:
 *     tags: [Auth]
 *     summary: Register a new user
 *     description: Avatar is required. Sets accessToken and refreshToken cookies.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [fullName, email, password, avatar]
 *             properties:
 *               fullName: { type: string, minLength: 2, example: Jane Doe }
 *               email: { type: string, format: email, example: jane@example.com }
 *               password: { type: string, minLength: 6, example: secret123 }
 *               avatar: { type: string, format: binary }
 *     responses:
 *       201:
 *         description: User registered successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/AuthUserPayload'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       409:
 *         $ref: '#/components/responses/Conflict'
 *
 * /auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Log in with email and password
 *     description: >
 *       Creates a session and sets accessToken and refreshToken cookies.
 *       If two-factor is enabled, returns 200 with a challengeToken instead.
 *       Then call /auth/2fa/verify-login.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email, example: jane@example.com }
 *               password: { type: string, example: secret123 }
 *     responses:
 *       201:
 *         description: Logged in successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/AuthUserPayload'
 *       200:
 *         description: Two-factor verification required
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/TwoFactorChallenge'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *
 * /auth/logout:
 *   post:
 *     tags: [Auth]
 *     summary: Log out and revoke the current session
 *     description: Needs the refreshToken cookie. Clears both cookies.
 *     responses:
 *       200:
 *         description: Logged out successfully
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *
 * /auth/check:
 *   get:
 *     tags: [Auth]
 *     summary: Check whether the user is authenticated
 *     responses:
 *       200:
 *         description: Authenticated user fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       additionalProperties: true
 *                       properties:
 *                         id: { type: string }
 *                         fullName: { type: string }
 *                         email: { type: string }
 *                         avatar: { type: string }
 *                         twoFactorEnabled: { type: boolean }
 *                         loginAlerts: { type: boolean }
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *
 * /auth/change-password:
 *   patch:
 *     tags: [Auth]
 *     summary: Change password
 *     description: Limited to 5 requests per 15 minutes per IP. New password must be 6-15 characters.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [currentPassword, newPassword, confirmPassword]
 *             properties:
 *               currentPassword: { type: string }
 *               newPassword: { type: string, minLength: 6, maxLength: 15 }
 *               confirmPassword: { type: string }
 *     responses:
 *       200:
 *         description: Password changed successfully
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *
 * /auth/forgot-password:
 *   post:
 *     tags: [Auth]
 *     summary: Send a password reset email
 *     description: >
 *       Limited to 5 requests per 15 minutes per IP. Always returns the same
 *       message whether or not the email exists.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string, format: email }
 *     responses:
 *       200:
 *         description: Reset instructions sent (if the account exists)
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       500:
 *         description: Failed to send the reset email
 *
 * /auth/reset-password/{token}:
 *   post:
 *     tags: [Auth]
 *     summary: Reset password using the emailed token
 *     description: Limited to 5 requests per 15 minutes per IP.
 *     security: []
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [password, confirmPassword]
 *             properties:
 *               password: { type: string, minLength: 6, maxLength: 15 }
 *               confirmPassword: { type: string }
 *     responses:
 *       200:
 *         description: Password reset successfully
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *
 * /auth/security/login-alerts:
 *   patch:
 *     tags: [Auth]
 *     summary: Turn login alert emails on or off
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [enabled]
 *             properties:
 *               enabled: { type: boolean }
 *     responses:
 *       200:
 *         description: Login alerts updated
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         loginAlerts: { type: boolean }
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *
 * /auth/sessions:
 *   get:
 *     tags: [Sessions]
 *     summary: List active sessions
 *     responses:
 *       200:
 *         description: Sessions retrieved
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         sessions:
 *                           type: array
 *                           items:
 *                             $ref: '#/components/schemas/Session'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *
 * /auth/sessions/revoke-others:
 *   post:
 *     tags: [Sessions]
 *     summary: Sign out of all other sessions
 *     responses:
 *       200:
 *         description: Other sessions revoked
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         revokedCount: { type: integer }
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *
 * /auth/sessions/{sessionId}:
 *   delete:
 *     tags: [Sessions]
 *     summary: Revoke one session
 *     parameters:
 *       - $ref: '#/components/parameters/SessionId'
 *     responses:
 *       200:
 *         description: Session revoked successfully
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       409:
 *         $ref: '#/components/responses/Conflict'
 *
 * /auth/2fa/setup:
 *   post:
 *     tags: [Auth]
 *     summary: Start two-factor setup
 *     description: Returns a QR code and a manual key for the authenticator app. The setup is not active until you call /auth/2fa/enable.
 *     responses:
 *       200:
 *         description: Scan the QR code, then verify with a code
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         qrCodeUrl:
 *                           type: string
 *                           description: QR code as a data URL (data:image/png;base64,...)
 *                         manualKey:
 *                           type: string
 *                           example: "JBSW Y3DP EHPK 3PXP"
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       409:
 *         description: Two-step verification is already enabled
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *
 * /auth/2fa/enable:
 *   post:
 *     tags: [Auth]
 *     summary: Confirm setup and enable two-factor
 *     description: Limited to 10 requests per 15 minutes. Call /auth/2fa/setup first.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code]
 *             properties:
 *               code:
 *                 type: string
 *                 description: 6-digit code from the authenticator app
 *                 example: "123456"
 *     responses:
 *       200:
 *         description: Two-step verification enabled. Recovery codes are shown only once.
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/RecoveryCodesResult'
 *       400:
 *         description: Code missing, or no pending setup found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Not logged in, or invalid / expired verification code
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *
 * /auth/2fa/verify-login:
 *   post:
 *     tags: [Auth]
 *     summary: Finish login with a two-factor code
 *     description: >
 *       Public. Use the challengeToken returned by /auth/login. Limited to 10
 *       requests per 15 minutes. Set useRecoveryCode to true to use a recovery
 *       code instead of an authenticator code (each recovery code works once).
 *       Sets accessToken and refreshToken cookies and creates a session.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [challengeToken, code]
 *             properties:
 *               challengeToken: { type: string }
 *               code:
 *                 type: string
 *                 example: "123456"
 *               useRecoveryCode:
 *                 type: boolean
 *                 default: false
 *     responses:
 *       200:
 *         description: Two-factor verification successful
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         id: { type: string }
 *                         fullName: { type: string }
 *                         email: { type: string }
 *                         avatar: { type: string }
 *                         twoFactorEnabled: { type: boolean, example: true }
 *                         token:
 *                           type: object
 *                           properties:
 *                             accessToken: { type: string }
 *                             refreshToken: { type: string }
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         description: Challenge expired or invalid, 2FA not enabled, or wrong code
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *
 * /auth/2fa/disable:
 *   post:
 *     tags: [Auth]
 *     summary: Disable two-factor
 *     description: Limited to 10 requests per 15 minutes. Needs a current authenticator code. Recovery codes are not accepted here.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code]
 *             properties:
 *               code:
 *                 type: string
 *                 example: "123456"
 *     responses:
 *       200:
 *         description: Two-step verification disabled
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         description: Not logged in, or invalid authenticator code
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: Two-step verification is not enabled
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *
 * /auth/2fa/recovery-codes/regenerate:
 *   post:
 *     tags: [Auth]
 *     summary: Generate a new set of recovery codes
 *     description: Limited to 10 requests per 15 minutes. Needs a current authenticator code. Previous recovery codes stop working.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code]
 *             properties:
 *               code:
 *                 type: string
 *                 example: "123456"
 *     responses:
 *       200:
 *         description: Recovery codes regenerated
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/RecoveryCodesResult'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         description: Not logged in, or invalid authenticator code
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: Two-step verification is not enabled
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *
 * /auth/account:
 *   delete:
 *     tags: [Auth]
 *     summary: Permanently delete the account
 *     description: >
 *       Limited to 5 requests per 15 minutes per IP. This cannot be undone. It deletes
 *       the user's messages, sessions and uploaded images, removes them from groups
 *       (ownership passes to another member, and empty groups are deleted), and
 *       disconnects their sockets. If two-factor is enabled, a code is required.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [confirmation, password]
 *             properties:
 *               confirmation:
 *                 type: string
 *                 enum: [DELETE]
 *                 description: Must be exactly DELETE
 *               password: { type: string }
 *               code:
 *                 type: string
 *                 description: Required only if two-factor is enabled
 *                 example: "123456"
 *               useRecoveryCode:
 *                 type: boolean
 *                 default: false
 *                 description: Set true if "code" is a recovery code
 *     responses:
 *       200:
 *         description: Your account has been permanently deleted
 *       400:
 *         description: Wrong confirmation word, or password / code missing
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Not logged in, wrong password, or invalid 2FA / recovery code
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
export {};
