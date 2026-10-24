/**
 * @openapi
 * /users/me:
 *   get:
 *     tags: [Users]
 *     summary: Get the current user
 *     responses:
 *       200:
 *         description: Current user fetched
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
 *                         user:
 *                           $ref: '#/components/schemas/User'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *
 * /users/profile:
 *   patch:
 *     tags: [Users]
 *     summary: Update profile fields
 *     description: Send only the fields you want to change. An empty string removes an optional field.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               fullName: { type: string, minLength: 2, maxLength: 50 }
 *               username: { type: string, example: jane_doe }
 *               phone: { type: string, example: "+91 98765 43210" }
 *               gender:
 *                 type: string
 *                 enum: [Female, Male, Other, Prefer not to say, ""]
 *               dob: { type: string, format: date }
 *               location: { type: string, maxLength: 60 }
 *               website: { type: string, example: "https://example.com" }
 *               bio: { type: string, maxLength: 160 }
 *               timezone: { type: string, example: Asia/Kolkata }
 *     responses:
 *       200:
 *         description: Profile updated
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
 *                         user:
 *                           $ref: '#/components/schemas/User'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       409:
 *         description: Username already taken
 *
 * /users/profile/avatar:
 *   patch:
 *     tags: [Users]
 *     summary: Upload or replace avatar
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [avatar]
 *             properties:
 *               avatar:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Avatar updated
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *   delete:
 *     tags: [Users]
 *     summary: Remove avatar
 *     responses:
 *       200:
 *         description: Avatar removed
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *
 * /users/privacy:
 *   get:
 *     tags: [Users]
 *     summary: Get privacy settings
 *     responses:
 *       200:
 *         description: Privacy settings
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/PrivacySettings'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *   patch:
 *     tags: [Users]
 *     summary: Update privacy settings
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PrivacySettings'
 *     responses:
 *       200:
 *         description: Privacy settings updated
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *
 * /users/chat-prefs:
 *   get:
 *     tags: [Users]
 *     summary: Get chat preferences
 *     responses:
 *       200:
 *         description: Chat preferences
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/ChatPrefs'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *   patch:
 *     tags: [Users]
 *     summary: Update chat preferences
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ChatPrefs'
 *     responses:
 *       200:
 *         description: Chat preferences updated
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *
 * /users/appearance:
 *   get:
 *     tags: [Users]
 *     summary: Get appearance preferences
 *     responses:
 *       200:
 *         description: Appearance preferences
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/Appearance'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *   patch:
 *     tags: [Users]
 *     summary: Update appearance preferences
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Appearance'
 *     responses:
 *       200:
 *         description: Appearance preferences updated
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *
 * /users/{id}/block:
 *   post:
 *     tags: [Users]
 *     summary: Block a user (also removes them from favorites)
 *     parameters:
 *       - $ref: '#/components/parameters/UserId'
 *     responses:
 *       200: { description: User blocked }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *   delete:
 *     tags: [Users]
 *     summary: Unblock a user
 *     parameters:
 *       - $ref: '#/components/parameters/UserId'
 *     responses:
 *       200: { description: User unblocked }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *
 * /users/{id}/favorite:
 *   post:
 *     tags: [Users]
 *     summary: Add a user to favorites
 *     parameters:
 *       - $ref: '#/components/parameters/UserId'
 *     responses:
 *       200: { description: Added to favorites }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *   delete:
 *     tags: [Users]
 *     summary: Remove a user from favorites
 *     parameters:
 *       - $ref: '#/components/parameters/UserId'
 *     responses:
 *       200: { description: Removed from favorites }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
export {};
