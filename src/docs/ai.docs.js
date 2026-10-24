/**
 * @openapi
 * components:
 *   responses:
 *     TooManyRequests:
 *       description: Rate limit exceeded (or AI provider quota reached)
 *       headers:
 *         RateLimit-Limit:
 *           schema: { type: integer }
 *         RateLimit-Remaining:
 *           schema: { type: integer }
 *         RateLimit-Reset:
 *           schema: { type: integer }
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               success: { type: boolean, example: false }
 *               message:
 *                 type: string
 *                 example: Too many AI requests. Please wait a minute.
 *     AiBadGateway:
 *       description: AI service returned an invalid, empty or failed response
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ErrorResponse'
 *     AiUnavailable:
 *       description: AI is busy or unreachable. Try again in a few seconds.
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ErrorResponse'
 *   schemas:
 *     AiText:
 *       type: string
 *       minLength: 1
 *       maxLength: 2000
 *     ChatbotMessage:
 *       type: object
 *       required: [role]
 *       description: >
 *         One chat turn. The last item in the array must be from the user.
 *         Adjust field names to match utils/aiChatContents.js.
 *       properties:
 *         role:
 *           type: string
 *           enum: [user, assistant]
 *           example: user
 *         content:
 *           type: string
 *           example: How do I create a group?
 *
 * /ai/chatbot:
 *   post:
 *     tags: [AI]
 *     summary: Chat with the Chatty help bot
 *     description: >
 *       Public endpoint (no login needed). Limited to 10 requests per minute per IP.
 *       Send the conversation so far; the last message must be from the user.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [messages]
 *             properties:
 *               messages:
 *                 type: array
 *                 minItems: 1
 *                 items:
 *                   $ref: '#/components/schemas/ChatbotMessage'
 *           example:
 *             messages:
 *               - role: user
 *                 content: How do I create a group?
 *     responses:
 *       200:
 *         description: Reply generated successfully
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
 *                         reply:
 *                           type: string
 *                           example: Open the Groups tab, tap New Group, pick members and give it a name.
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       502:
 *         $ref: '#/components/responses/AiBadGateway'
 *       503:
 *         $ref: '#/components/responses/AiUnavailable'
 *
 * /ai/correct:
 *   post:
 *     tags: [AI]
 *     summary: Correct English grammar, spelling and punctuation
 *     description: Requires login. Limited to 20 requests per minute per user. Text is max 2000 characters.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [text]
 *             properties:
 *               text:
 *                 $ref: '#/components/schemas/AiText'
 *           example:
 *             text: i has went to market yesterday
 *     responses:
 *       200:
 *         description: English corrected successfully
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
 *                         original:
 *                           type: string
 *                           example: i has went to market yesterday
 *                         corrected:
 *                           type: string
 *                           example: I went to the market yesterday.
 *                         changes:
 *                           type: array
 *                           items: { type: string }
 *                           example:
 *                             - Changed "i has went" to "I went"
 *                             - Added "the" before "market"
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       502:
 *         $ref: '#/components/responses/AiBadGateway'
 *       503:
 *         $ref: '#/components/responses/AiUnavailable'
 *
 * /ai/rewrite:
 *   post:
 *     tags: [AI]
 *     summary: Rewrite text in a chosen tone
 *     description: Requires login. Limited to 20 requests per minute per user. Text is max 2000 characters.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [text, tone]
 *             properties:
 *               text:
 *                 $ref: '#/components/schemas/AiText'
 *               tone:
 *                 type: string
 *                 enum: [formal, casual, friendly, professional, persuasive]
 *           example:
 *             text: send me the file fast
 *             tone: professional
 *     responses:
 *       200:
 *         description: Text rewritten successfully
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
 *                         original: { type: string }
 *                         tone: { type: string, example: professional }
 *                         rewritten:
 *                           type: string
 *                           example: Could you please send me the file at your earliest convenience?
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       502:
 *         $ref: '#/components/responses/AiBadGateway'
 *       503:
 *         $ref: '#/components/responses/AiUnavailable'
 *
 * /ai/hinglish:
 *   post:
 *     tags: [AI]
 *     summary: Translate Hinglish to English
 *     description: Requires login. Limited to 20 requests per minute per user. Text is max 2000 characters.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [text]
 *             properties:
 *               text:
 *                 $ref: '#/components/schemas/AiText'
 *           example:
 *             text: Mujhe kal meeting mein late ho gaya
 *     responses:
 *       200:
 *         description: Hinglish translated successfully
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
 *                         original: { type: string }
 *                         translated:
 *                           type: string
 *                           example: I was late to the meeting yesterday.
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       502:
 *         $ref: '#/components/responses/AiBadGateway'
 *       503:
 *         $ref: '#/components/responses/AiUnavailable'
 */
export {};
