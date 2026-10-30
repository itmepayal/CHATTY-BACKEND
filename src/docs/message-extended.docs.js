/**
 * @openapi
 * components:
 *   schemas:
 *     LocationShareRecord:
 *       type: object
 *       description: A live location share session.
 *       properties:
 *         _id: { type: string, example: 665f1c2e9b1e8a0012a4d001 }
 *         sharerId: { type: string }
 *         receiverId: { type: string }
 *         status:
 *           type: string
 *           enum: [active, stopped, expired]
 *         expiresAt: { type: string, format: date-time }
 *         messageId: { type: string, nullable: true }
 *         lastLocation:
 *           type: object
 *           properties:
 *             lat: { type: number, example: 23.0225 }
 *             lng: { type: number, example: 72.5714 }
 *             accuracy: { type: number, nullable: true, example: 15.0 }
 *             updatedAt: { type: string, format: date-time }
 *     ScheduledMessageRecord:
 *       type: object
 *       description: A pending scheduled message.
 *       properties:
 *         _id: { type: string, example: 665f1c2e9b1e8a0012a4e001 }
 *         senderId: { type: string }
 *         receiverId: { type: string }
 *         text: { type: string }
 *         scheduledFor: { type: string, format: date-time }
 *         status:
 *           type: string
 *           enum: [pending, sent, cancelled, failed]
 *         e2ee: { type: boolean, nullable: true }
 *         createdAt: { type: string, format: date-time }
 *
 * /messages/forward/{messageId}:
 *   post:
 *     tags: [Messages]
 *     operationId: forwardMessage
 *     summary: Forward a message to one or more users
 *     description: >
 *       Forwards an existing message (which you must have access to) to up to
 *       5 recipients. The forwarder must be able to message each recipient.
 *       Encrypted messages require per-recipient ciphertext in the `encrypted`
 *       map. Rate limited to 10 forwards per minute per user.
 *     parameters:
 *       - $ref: '#/components/parameters/MessageId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [userIds]
 *             properties:
 *               userIds:
 *                 type: array
 *                 minItems: 1
 *                 maxItems: 5
 *                 items: { type: string }
 *                 description: List of recipient user IDs (max 5, excluding yourself)
 *                 example: ["665f1c2e9b1e8a0012a4b123"]
 *               encrypted:
 *                 type: object
 *                 description: >
 *                   Required when forwarding an E2EE message. Keys are recipient
 *                   user IDs; each value provides the re-encrypted ciphertext and IV.
 *                 additionalProperties:
 *                   type: object
 *                   properties:
 *                     text: { type: string }
 *                     iv: { type: string }
 *     responses:
 *       200:
 *         description: Message(s) forwarded (partial failures included in response message)
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
 *                         $ref: '#/components/schemas/MessageView'
 *       400:
 *         description: No recipients, too many recipients, or invalid recipient ID
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: You cannot forward this message (deleted, expired, or not yours)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *
 * /messages/edit/{messageId}:
 *   patch:
 *     tags: [Messages]
 *     operationId: editMessage
 *     summary: Edit a sent message
 *     description: >
 *       Only the sender can edit their own message. Edits are allowed within a
 *       15-minute window. Voice and video messages cannot be edited. Encryption
 *       mode cannot be changed. Rate limited to 15 edits per 10 seconds per user.
 *     parameters:
 *       - $ref: '#/components/parameters/MessageId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [text]
 *             properties:
 *               text:
 *                 type: string
 *                 maxLength: 4000
 *                 description: New message text (max 4000 chars; 24000 for E2EE payload)
 *               encrypted:
 *                 type: boolean
 *                 description: Set true when editing an E2EE message
 *               iv:
 *                 type: string
 *                 description: IV string for E2EE messages
 *     responses:
 *       200:
 *         description: Message edited (or no changes)
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
 *                         messageId: { type: string }
 *                         text: { type: string }
 *                         isEdited: { type: boolean, example: true }
 *                         editedAt: { type: string, format: date-time }
 *       400:
 *         description: Empty text, text too long, edit window expired, or encryption mode mismatch
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Only the sender can edit
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *
 * /messages/pin/{messageId}:
 *   patch:
 *     tags: [Messages]
 *     operationId: togglePin
 *     summary: Pin or unpin a message
 *     description: >
 *       Either participant can pin or unpin a message. A conversation can have
 *       at most 3 pinned messages. Attempting to pin a fourth message returns 400.
 *     parameters:
 *       - $ref: '#/components/parameters/MessageId'
 *     responses:
 *       200:
 *         description: Pin status toggled
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
 *                         messageId: { type: string }
 *                         isPinned: { type: boolean }
 *                         pinnedBy: { type: string }
 *       400:
 *         description: Max pins reached (3), or messaging is blocked
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *
 * /messages/pinned/{id}:
 *   get:
 *     tags: [Messages]
 *     operationId: getPinned
 *     summary: Get pinned messages in a conversation
 *     description: Returns all pinned (and not deleted) messages in the conversation with the given user, sorted by most recently pinned.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: The other user's ID
 *         example: 665f1c2e9b1e8a0012a4b123
 *     responses:
 *       200:
 *         description: Pinned messages
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
 *                         $ref: '#/components/schemas/MessageView'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *
 * /messages/search/{id}:
 *   get:
 *     tags: [Messages]
 *     operationId: searchMessages
 *     summary: Search text messages in a conversation
 *     description: >
 *       Searches non-deleted, non-encrypted messages in the conversation with
 *       the given user. Returns at most 50 results (default 30). Requires at
 *       least 2 characters in the query `q`.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: The other user's ID
 *         example: 665f1c2e9b1e8a0012a4b123
 *       - in: query
 *         name: q
 *         required: true
 *         schema: { type: string, minLength: 2 }
 *         description: Search text (min 2 characters)
 *         example: hello
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 50
 *           default: 30
 *     responses:
 *       200:
 *         description: Search results (empty array if query too short)
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
 *                         type: object
 *                         properties:
 *                           id: { type: string }
 *                           senderId: { type: string }
 *                           text: { type: string }
 *                           createdAt: { type: string, format: date-time }
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *
 * /messages/schedule/{id}:
 *   post:
 *     tags: [Messages]
 *     operationId: scheduleMessage
 *     summary: Schedule a message to be sent later
 *     description: >
 *       Creates a scheduled message that will be delivered at `scheduledFor`.
 *       The time must be at least 30 seconds in the future and at most 30 days
 *       from now. Only text messages are supported (no attachments). Rate limited
 *       to 15 requests per 10 seconds per user.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Receiver's user ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [text, scheduledFor]
 *             properties:
 *               text:
 *                 type: string
 *                 maxLength: 4000
 *                 example: Don't forget the meeting!
 *               scheduledFor:
 *                 type: string
 *                 format: date-time
 *                 description: ISO 8601 datetime (min 30 seconds from now, max 30 days)
 *                 example: "2026-11-01T09:00:00.000Z"
 *               encrypted:
 *                 type: boolean
 *                 description: Set true for E2EE payload
 *               iv:
 *                 type: string
 *                 description: IV string for E2EE messages
 *     responses:
 *       201:
 *         description: Message scheduled
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/ScheduledMessageRecord'
 *       400:
 *         description: Invalid time, empty text, text too long, or messaging yourself
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Not allowed to message this user
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *
 * /messages/scheduled:
 *   get:
 *     tags: [Messages]
 *     operationId: getScheduled
 *     summary: Get pending scheduled messages
 *     description: Returns the current user's pending scheduled messages, sorted by scheduled time ascending. Optionally filter by receiver.
 *     parameters:
 *       - in: query
 *         name: to
 *         schema: { type: string }
 *         description: Filter by receiver user ID
 *     responses:
 *       200:
 *         description: Scheduled messages
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
 *                         $ref: '#/components/schemas/ScheduledMessageRecord'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *
 * /messages/scheduled/{scheduleId}:
 *   delete:
 *     tags: [Messages]
 *     operationId: cancelScheduled
 *     summary: Cancel a pending scheduled message
 *     description: Marks a pending scheduled message as cancelled. Only the sender can cancel it.
 *     parameters:
 *       - in: path
 *         name: scheduleId
 *         required: true
 *         schema: { type: string }
 *         description: MongoDB ObjectId of the scheduled message
 *         example: 665f1c2e9b1e8a0012a4e001
 *     responses:
 *       200:
 *         description: Scheduled message cancelled
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
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         description: Scheduled message not found or already sent/cancelled
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *
 * /messages/disappearing/{id}:
 *   get:
 *     tags: [Messages]
 *     operationId: getDisappearing
 *     summary: Get disappearing messages timer for a conversation
 *     description: Returns the current disappearing-messages timer (in seconds) for the conversation with the given user. 0 means disabled.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: The other user's ID
 *     responses:
 *       200:
 *         description: Disappearing setting
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
 *                         seconds:
 *                           type: integer
 *                           enum: [0, 86400, 604800, 7776000]
 *                           description: "0=off, 86400=24h, 604800=7d, 7776000=90d"
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *   put:
 *     tags: [Messages]
 *     operationId: setDisappearing
 *     summary: Set or disable disappearing messages for a conversation
 *     description: >
 *       Sets the auto-delete timer for messages in this conversation.
 *       Allowed values: 0 (off), 86400 (1 day), 604800 (7 days), 7776000 (90 days).
 *       Both users are notified via Socket.IO. Rate limited to 20 changes per
 *       minute per user.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: The other user's ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [seconds]
 *             properties:
 *               seconds:
 *                 type: integer
 *                 enum: [0, 86400, 604800, 7776000]
 *                 example: 86400
 *     responses:
 *       200:
 *         description: Disappearing messages setting updated
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
 *                         seconds: { type: integer }
 *       400:
 *         description: Invalid timer value or user ID
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Messaging blocked
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *
 * /messages/archive/{id}:
 *   patch:
 *     tags: [Messages]
 *     operationId: setArchive
 *     summary: Archive or unarchive a chat
 *     description: >
 *       Archives or unarchives the conversation with the given user for the
 *       current user only. The other user is not affected. Rate limited to
 *       20 changes per minute per user.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: The other user's ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [archived]
 *             properties:
 *               archived:
 *                 type: boolean
 *                 description: true to archive, false to unarchive
 *     responses:
 *       200:
 *         description: Chat archived or unarchived
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
 *                         userId: { type: string }
 *                         archived: { type: boolean }
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *
 * /messages/report/{id}:
 *   post:
 *     tags: [Messages]
 *     operationId: reportUser
 *     summary: Report a user
 *     description: >
 *       Submits a report against another user. You can report at most once per
 *       user in a 24-hour window. Optionally attach a specific message that
 *       demonstrates the issue. Rate limited to 10 reports per hour per user.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: ID of the user being reported
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reason]
 *             properties:
 *               reason:
 *                 type: string
 *                 enum: [spam, harassment, inappropriate, impersonation, other]
 *                 example: spam
 *               details:
 *                 type: string
 *                 maxLength: 500
 *                 description: Optional additional context (truncated to 500 chars)
 *                 example: "Sending unsolicited promotional messages"
 *               messageId:
 *                 type: string
 *                 description: Optional ID of a specific message to attach as evidence
 *     responses:
 *       201:
 *         description: Report submitted
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       nullable: true
 *       400:
 *         description: Reporting yourself, invalid reason, or invalid message ID
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       409:
 *         description: Already reported this user in the last 24 hours
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *
 * /messages/location/share:
 *   post:
 *     tags: [Location]
 *     operationId: startShare
 *     summary: Share current location or start a live location session
 *     description: >
 *       Two modes are supported:
 *       - **current**: Sends a one-time location message immediately.
 *       - **live**: Creates a live location session that auto-expires after `durationMin`
 *         minutes (15, 60, or 480). Previous active live shares to the same receiver are
 *         stopped first. A message is created for the live share. Rate limited to 20
 *         requests per minute per user.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [receiverId, mode, lat, lng]
 *             properties:
 *               receiverId:
 *                 type: string
 *                 description: Recipient user ID
 *                 example: 665f1c2e9b1e8a0012a4b123
 *               mode:
 *                 type: string
 *                 enum: [current, live]
 *                 example: live
 *               lat:
 *                 type: number
 *                 format: double
 *                 example: 23.0225
 *               lng:
 *                 type: number
 *                 format: double
 *                 example: 72.5714
 *               accuracy:
 *                 type: number
 *                 nullable: true
 *                 description: Location accuracy in metres
 *                 example: 10.0
 *               durationMin:
 *                 type: integer
 *                 enum: [15, 60, 480]
 *                 description: Required when mode is "live". Duration in minutes.
 *                 example: 15
 *     responses:
 *       201:
 *         description: Location sent (current) or live session started
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       oneOf:
 *                         - $ref: '#/components/schemas/MessageView'
 *                         - type: object
 *                           description: Live location response
 *                           properties:
 *                             message:
 *                               $ref: '#/components/schemas/MessageView'
 *                             share:
 *                               $ref: '#/components/schemas/LocationShareRecord'
 *       400:
 *         description: Invalid receiver, invalid mode, invalid coordinates, or invalid duration
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Messaging not allowed (blocked)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *
 * /messages/location/stop/{id}:
 *   patch:
 *     tags: [Location]
 *     operationId: stopShare
 *     summary: Stop an active live location share
 *     description: Stops a live location session started by the current user. Emits a `location:ended` Socket.IO event to both parties. Rate limited to 20 requests per minute per user.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: MongoDB ObjectId of the active LocationShare
 *         example: 665f1c2e9b1e8a0012a4d001
 *     responses:
 *       200:
 *         description: Live location stopped
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
 *                         shareId: { type: string }
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         description: Active live share not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *
 * /messages/location/active:
 *   get:
 *     tags: [Location]
 *     operationId: getActiveShares
 *     summary: Get active live location shares
 *     description: Returns two lists - live shares started by the current user (`mine`) and live shares targeting the current user (`forMe`). Expired shares are cleaned up automatically on this call.
 *     responses:
 *       200:
 *         description: Active location shares
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
 *                         mine:
 *                           type: array
 *                           items:
 *                             $ref: '#/components/schemas/LocationShareRecord'
 *                         forMe:
 *                           type: array
 *                           items:
 *                             $ref: '#/components/schemas/LocationShareRecord'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
export {};
