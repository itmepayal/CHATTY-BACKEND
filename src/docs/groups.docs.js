/**
 * @openapi
 * components:
 *   parameters:
 *     GroupMemberUserId:
 *       in: path
 *       name: userId
 *       required: true
 *       schema:
 *         type: string
 *       description: Id of the member to act on
 *   schemas:
 *     GroupMemberView:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *         fullName:
 *           type: string
 *         avatar:
 *           type: string
 *         role:
 *           type: string
 *           enum: [admin, member]
 *         joinedAt:
 *           type: string
 *           format: date-time
 *     GroupMessageView:
 *       type: object
 *       description: Group message as returned by the API (formatGroupMessage).
 *       properties:
 *         id:
 *           type: string
 *         groupId:
 *           type: string
 *         senderId:
 *           type: string
 *         sender:
 *           type: object
 *           nullable: true
 *           properties:
 *             id:
 *               type: string
 *             fullName:
 *               type: string
 *             avatar:
 *               type: string
 *         text:
 *           type: string
 *         image:
 *           type: object
 *           nullable: true
 *           properties:
 *             url:
 *               type: string
 *             public_id:
 *               type: string
 *         file:
 *           type: object
 *           nullable: true
 *           properties:
 *             url:
 *               type: string
 *             name:
 *               type: string
 *             size:
 *               type: number
 *             mimeType:
 *               type: string
 *         audio:
 *           type: object
 *           nullable: true
 *           properties:
 *             url:
 *               type: string
 *             duration:
 *               type: number
 *             mimeType:
 *               type: string
 *         clientId:
 *           type: string
 *         readBy:
 *           type: array
 *           items:
 *             type: string
 *         createdAt:
 *           type: string
 *           format: date-time
 *     GroupView:
 *       type: object
 *       description: Group as returned by the API (formatGroup). unreadCount and lastMessage are filled in only by GET /groups.
 *       properties:
 *         id:
 *           type: string
 *         name:
 *           type: string
 *           minLength: 2
 *           maxLength: 50
 *         avatar:
 *           type: string
 *         owner:
 *           type: string
 *         members:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/GroupMemberView'
 *         createdAt:
 *           type: string
 *           format: date-time
 *         lastMessageAt:
 *           type: string
 *           format: date-time
 *         unreadCount:
 *           type: integer
 *         lastMessage:
 *           nullable: true
 *           allOf:
 *             - $ref: '#/components/schemas/GroupMessageView'
 *
 * /groups:
 *   post:
 *     tags: [Groups]
 *     summary: Create a group
 *     description: >
 *       You become the owner and an admin. Add at least one other member
 *       (a group can have up to 256 members). Blocked users can't be added.
 *       Path and avatar field name are assumed, so check your group route file.
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [name, memberIds]
 *             properties:
 *               name:
 *                 type: string
 *                 minLength: 2
 *                 maxLength: 50
 *                 example: Project Team
 *               memberIds:
 *                 type: string
 *                 description: JSON array of user ids, or a comma-separated list
 *                 example: '["665f1c2e9b1e8a0012a4b123","665f1c2e9b1e8a0012a4b124"]'
 *               avatar:
 *                 type: string
 *                 format: binary
 *     responses:
 *       201:
 *         description: Group created
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/GroupView'
 *       400:
 *         description: Invalid name or ids, no members, too many members, or a user can't be added
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *   get:
 *     tags: [Groups]
 *     summary: List my groups
 *     description: Sorted by latest activity. Unread counts and last messages ignore messages from users you blocked and from before you joined.
 *     responses:
 *       200:
 *         description: Groups fetched
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
 *                         $ref: '#/components/schemas/GroupView'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *
 * /groups/{groupId}:
 *   get:
 *     tags: [Groups]
 *     summary: Get one group
 *     description: Only members can view a group.
 *     parameters:
 *       - $ref: '#/components/parameters/GroupId'
 *     responses:
 *       200:
 *         description: Group fetched
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/GroupView'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *   patch:
 *     tags: [Groups]
 *     summary: Update group name or avatar
 *     description: Admins only. Send a name, an avatar, or both. The old avatar is deleted.
 *     parameters:
 *       - $ref: '#/components/parameters/GroupId'
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 minLength: 2
 *                 maxLength: 50
 *               avatar:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Group updated
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/GroupView'
 *       400:
 *         description: Invalid name, or no changes to update
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
 *   delete:
 *     tags: [Groups]
 *     summary: Delete the group
 *     description: Owner only. Deletes all messages and uploaded media permanently.
 *     parameters:
 *       - $ref: '#/components/parameters/GroupId'
 *     responses:
 *       200:
 *         description: Group deleted
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
 *                         groupId:
 *                           type: string
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *
 * /groups/{groupId}/members:
 *   post:
 *     tags: [Groups]
 *     summary: Add members
 *     description: Admins only. Users already in the group are ignored. New members only see messages sent after they join.
 *     parameters:
 *       - $ref: '#/components/parameters/GroupId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [memberIds]
 *             properties:
 *               memberIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["665f1c2e9b1e8a0012a4b125"]
 *     responses:
 *       200:
 *         description: Members added
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/GroupView'
 *       400:
 *         description: Invalid ids, no new members, or the 256 member limit would be exceeded
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
 * /groups/{groupId}/members/{userId}:
 *   delete:
 *     tags: [Groups]
 *     summary: Remove a member
 *     description: Admins only. Only the owner can remove an admin. The owner can't be removed, and you can't remove yourself (use leave instead).
 *     parameters:
 *       - $ref: '#/components/parameters/GroupId'
 *       - $ref: '#/components/parameters/GroupMemberUserId'
 *     responses:
 *       200:
 *         description: Member removed
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/GroupView'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *
 * /groups/{groupId}/members/{userId}/role:
 *   patch:
 *     tags: [Groups]
 *     summary: Change a member's role
 *     description: >
 *       Admins only. You can't change your own role or the owner's role.
 *       Only the owner can demote an admin.
 *     parameters:
 *       - $ref: '#/components/parameters/GroupId'
 *       - $ref: '#/components/parameters/GroupMemberUserId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [role]
 *             properties:
 *               role:
 *                 type: string
 *                 enum: [admin, member]
 *     responses:
 *       200:
 *         description: Role updated
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/GroupView'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *
 * /groups/{groupId}/leave:
 *   post:
 *     tags: [Groups]
 *     summary: Leave the group
 *     description: >
 *       If you were the owner, ownership passes to the longest-serving admin.
 *       If no admin is left, the longest-serving member becomes admin. If you
 *       were the last member, the group is deleted.
 *     parameters:
 *       - $ref: '#/components/parameters/GroupId'
 *     responses:
 *       200:
 *         description: You left the group
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *
 * /groups/{groupId}/messages:
 *   get:
 *     tags: [Groups]
 *     summary: Get group messages
 *     description: >
 *       Returns oldest first. You only see messages sent after you joined, and
 *       messages from users you blocked are hidden. Use "before" to load older pages.
 *     parameters:
 *       - $ref: '#/components/parameters/GroupId'
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 100
 *           maximum: 200
 *       - in: query
 *         name: before
 *         description: Only return messages older than this date
 *         schema:
 *           type: string
 *           format: date-time
 *     responses:
 *       200:
 *         description: Group messages fetched
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
 *                         $ref: '#/components/schemas/GroupMessageView'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *   post:
 *     tags: [Groups]
 *     summary: Send a group message
 *     description: >
 *       Send text, an attachment, or both. Images become image messages and other
 *       files become file messages. For a voice note, upload an audio file and set
 *       isVoice=true. If clientId was already used, the existing message is returned
 *       with 200. The attachment field name is assumed to be "image", so check your route.
 *     parameters:
 *       - $ref: '#/components/parameters/GroupId'
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               text:
 *                 type: string
 *                 maxLength: 2000
 *               image:
 *                 type: string
 *                 format: binary
 *                 description: Image, file or audio attachment
 *               clientId:
 *                 type: string
 *                 maxLength: 64
 *               isVoice:
 *                 type: boolean
 *               duration:
 *                 type: number
 *                 description: Voice note length in seconds (max 300)
 *     responses:
 *       201:
 *         description: Message sent
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/GroupMessageView'
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
 *                       $ref: '#/components/schemas/GroupMessageView'
 *       400:
 *         description: Empty message, text over 2000 characters, voice message that is not audio, or upload failed
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
 * /groups/{groupId}/seen:
 *   patch:
 *     tags: [Groups]
 *     summary: Mark group messages as seen
 *     description: >
 *       Marks unread messages from others as read. If you turned off read
 *       receipts, they are marked read for you but other members are not told.
 *       The HTTP method and path are assumed, so check your group route file.
 *     parameters:
 *       - $ref: '#/components/parameters/GroupId'
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
 *                         count:
 *                           type: integer
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
export {};
