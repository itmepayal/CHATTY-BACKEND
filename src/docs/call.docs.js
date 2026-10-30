/**
 * @openapi
 * components:
 *   schemas:
 *     CallRecord:
 *       type: object
 *       description: A 1-to-1 call history record.
 *       properties:
 *         id: { type: string, example: 665f1c2e9b1e8a0012a4b123 }
 *         direction:
 *           type: string
 *           enum: [incoming, outgoing]
 *           example: outgoing
 *         type:
 *           type: string
 *           enum: [audio, video]
 *           example: video
 *         status:
 *           type: string
 *           enum: [missed, rejected, cancelled, completed, failed]
 *           example: completed
 *         duration:
 *           type: number
 *           nullable: true
 *           description: Call duration in seconds
 *           example: 145
 *         startedAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         user:
 *           type: object
 *           description: The other party in the call
 *           properties:
 *             id: { type: string }
 *             fullName: { type: string, example: Jane Doe }
 *             avatar: { type: string, example: "https://res.cloudinary.com/.../avatar.jpg" }
 *
 * /calls/history:
 *   get:
 *     tags: [Calls]
 *     operationId: getCallHistory
 *     summary: Get 1-to-1 call history
 *     description: >
 *       Returns the authenticated user's 1-to-1 call log (both incoming and
 *       outgoing), sorted by most recent first. The other party is populated
 *       with their name and avatar.
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 50
 *         description: Maximum number of records to return (capped at 100)
 *     responses:
 *       200:
 *         description: Call history fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/CallRecord'
 *             example:
 *               statusCode: 200
 *               success: true
 *               message: Call history fetched successfully.
 *               data:
 *                 - id: 665f1c2e9b1e8a0012a4b999
 *                   direction: outgoing
 *                   type: video
 *                   status: completed
 *                   duration: 145
 *                   startedAt: "2026-10-29T10:00:00.000Z"
 *                   user:
 *                     id: 665f1c2e9b1e8a0012a4b123
 *                     fullName: Jane Doe
 *                     avatar: "https://res.cloudinary.com/.../avatar.jpg"
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
export {};
