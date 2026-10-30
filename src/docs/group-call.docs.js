/**
 * @openapi
 * components:
 *   schemas:
 *     GroupCallRecord:
 *       type: object
 *       description: A single group call history record.
 *       properties:
 *         id: { type: string, example: 665f1c2e9b1e8a0012a4c001 }
 *         groupId: { type: string, example: 665f1c2e9b1e8a0012a4b777 }
 *         groupName: { type: string, example: Project Team }
 *         groupAvatar:
 *           type: string
 *           nullable: true
 *           example: "https://res.cloudinary.com/.../group.jpg"
 *         type:
 *           type: string
 *           enum: [audio, video]
 *           example: audio
 *         status:
 *           type: string
 *           enum: [missed, rejected, cancelled, completed, failed]
 *           example: completed
 *         duration:
 *           type: number
 *           nullable: true
 *           description: Duration in seconds
 *           example: 300
 *         startedAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         initiator:
 *           type: object
 *           nullable: true
 *           properties:
 *             id: { type: string }
 *             fullName: { type: string }
 *             avatar: { type: string, nullable: true }
 *         participants:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               id: { type: string }
 *               fullName: { type: string }
 *               avatar: { type: string, nullable: true }
 *
 * /group-calls/history:
 *   get:
 *     tags: [Group Calls]
 *     operationId: getMyGroupCalls
 *     summary: Get all group call history for the current user
 *     description: >
 *       Returns group calls that the current user participated in or was invited
 *       to across all groups, sorted by most recent first.
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 50
 *         description: Maximum number of records (capped at 100)
 *     responses:
 *       200:
 *         description: Group calls fetched successfully
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
 *                         $ref: '#/components/schemas/GroupCallRecord'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *
 * /group-calls/group/{id}:
 *   get:
 *     tags: [Group Calls]
 *     operationId: getGroupCallHistory
 *     summary: Get call history for a specific group
 *     description: >
 *       Returns calls for the specified group. The requesting user must be
 *       a member of the group. Results are sorted by most recent first.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: MongoDB ObjectId of the group
 *         example: 665f1c2e9b1e8a0012a4b777
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 50
 *         description: Maximum number of records (capped at 100)
 *     responses:
 *       200:
 *         description: Group call history fetched successfully
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
 *                         $ref: '#/components/schemas/GroupCallRecord'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: You are not a member of this group
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
export {};
