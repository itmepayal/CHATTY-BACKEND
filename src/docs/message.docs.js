/**
 * @openapi
 * components:
 *   schemas:
 *     MessageView:
 *       type: object
 *       description: Message as returned by the API (formatMessage). For a message deleted for everyone, text is empty and image, file, audio are null.
 *       properties:
 *         id: { type: string, example: 665f1c2e9b1e8a0012a4b123 }
 *         senderId: { type: string }
 *         receiverId: { type: string }
 *         text: { type: string, example: "Hey, how are you?" }
 *         image:
 *           type: object
 *           nullable: true
 *           properties:
 *             url: { type: string }
 *             public_id: { type: string }
 *         file:
 *           type: object
 *           nullable: true
 *           properties:
 *             url: { type: string }
 *             name: { type: string, example: report.pdf }
 *             size: { type: number, example: 204800 }
 *             mimeType: { type: string, example: application/pdf }
 *         audio:
 *           type: object
 *           nullable: true
 *           properties:
 *             url: { type: string }
 *             duration: { type: number, example: 12, description: "Seconds, max 300" }
 *             mimeType: { type: string, example: audio/webm }
 *         clientId: { type: string }
 *         reactions:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               userId: { type: string }
 *               emoji: { type: string, example: "👍" }
 *         isDeleted: { type: boolean }
 *         status: { type: string, enum: [sent, delivered, seen] }
 *         deliveredAt: { type: string, format: date-time }
 *         seenAt: { type: string, format: date-time }
 *         createdAt: { type: string, format: date-time }
 *     SidebarUser:
 *       type: object
 *       properties:
 *         id: { type: string }
 *         fullName: { type: string }
 *         email: { type: string }
 *         avatar: { type: string }
 *         isBlocked: { type: boolean }
 *         unreadCount: { type: integer, description: Always 0 for blocked users }
 *         lastMessage:
 *           nullable: true
 *           allOf:
 *             - $ref: '#/components/schemas/MessageView'
 *         lastMessageAt: { type: string, format: date-time, nullable: true }
 *         ts: { type: integer, description: Server timestamp in ms }
 *
 * /messages:
 *   get:
 *     tags: [Messages]
 *     summary: List users for the chat sidebar
 *     description: Returns every other user with their last message and unread count, sorted by latest activity.
 *     responses:
 *       200:
 *         description: Users fetched successfully
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
 *                         $ref: '#/components/schemas/SidebarUser'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *
 * /messages/{id}:
 *   get:
 *     tags: [Messages]
 *     summary: Get the conversation with a user
 *     description: Oldest first. Messages you deleted "for me" are left out.
 *     parameters:
 *       - $ref: '#/components/parameters/UserId'
 *     responses:
 *       200:
 *         description: User messages fetched successfully
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
 * /messages/send/{id}:
 *   post:
 *     tags: [Messages]
 *     summary: Send a message to a user
 *     description: >
 *       Send text, an attachment, or both. The attachment always goes in the
 *       form field named "image", whatever its type. Images become image messages,
 *       other files become file messages. To send a voice note, upload an audio
 *       file and set isVoice=true. If clientId was already used, the existing
 *       message is returned with 200 instead of creating a duplicate.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Receiver's user id
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               text: { type: string }
 *               image:
 *                 type: string
 *                 format: binary
 *                 description: Image, file or audio attachment
 *               clientId:
 *                 type: string
 *                 description: Client-generated id to prevent duplicate sends
 *               isVoice:
 *                 type: boolean
 *                 description: Treat an audio upload as a voice note
 *               duration:
 *                 type: number
 *                 description: Voice note length in seconds (max 300)
 *     responses:
 *       201:
 *         description: Message sent successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/MessageView'
 *       200:
 *         description: Message already sent (duplicate clientId)
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/MessageView'
 *       400:
 *         description: Invalid id, empty message, messaging yourself, or upload failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Not allowed to message this user (for example blocked)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *
 * /messages/seen/{id}:
 *   patch:
 *     tags: [Messages]
 *     summary: Mark messages from a user as seen
 *     description: >
 *       Marks all unread messages from that user as read. If you have turned off
 *       read receipts, they are marked read for you but the sender is not told.
 *     parameters:
 *       - $ref: '#/components/parameters/UserId'
 *     responses:
 *       200:
 *         description: Messages marked as seen
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
 *                         count: { type: integer, example: 3 }
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *
 * /messages/react/{messageId}:
 *   patch:
 *     tags: [Messages]
 *     summary: React to a message
 *     description: >
 *       Toggles the reaction. Sending a new emoji replaces your old one, and
 *       sending the same emoji again removes it. You can't react to deleted
 *       messages, or in chats where messaging is blocked.
 *     parameters:
 *       - $ref: '#/components/parameters/MessageId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [emoji]
 *             properties:
 *               emoji:
 *                 type: string
 *                 maxLength: 16
 *                 example: "👍"
 *     responses:
 *       200:
 *         description: Reaction updated successfully
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
 *                         reactions:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               userId: { type: string }
 *                               emoji: { type: string }
 *       400:
 *         description: Invalid id, invalid emoji, or message is deleted
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: You are not part of this chat, or messaging is blocked
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *
 * /messages/delete-for-me/{messageId}:
 *   delete:
 *     tags: [Messages]
 *     summary: Delete a message for yourself only
 *     description: Either person in the chat can do this. The other person still sees the message.
 *     parameters:
 *       - $ref: '#/components/parameters/MessageId'
 *     responses:
 *       200:
 *         description: Message deleted for you
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
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *
 * /messages/delete-for-everyone/{messageId}:
 *   delete:
 *     tags: [Messages]
 *     summary: Delete a message for everyone
 *     description: >
 *       Only the sender can do this. The text, reactions and any uploaded
 *       image, file or audio are removed permanently. Calling it again on an
 *       already deleted message returns 200.
 *     parameters:
 *       - $ref: '#/components/parameters/MessageId'
 *     responses:
 *       200:
 *         description: Message deleted for everyone (or already deleted)
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
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Only the sender can delete a message for everyone
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
export {};
