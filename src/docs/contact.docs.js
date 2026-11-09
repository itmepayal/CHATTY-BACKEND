/**
 * @openapi
 * components:
 *   schemas:
 *     ContactUser:
 *       type: object
 *       description: A user returned in the contacts list with optional nickname.
 *       properties:
 *         _id: { type: string, example: 665f1c2e9b1e8a0012a4b123 }
 *         fullName: { type: string, example: Jane Doe }
 *         username: { type: string, example: jane_doe }
 *         avatar:
 *           type: object
 *           nullable: true
 *           properties:
 *             url: { type: string }
 *             public_id: { type: string }
 *         lastSeen: { type: string, format: date-time }
 *         showOnlineStatus: { type: boolean }
 *         nickname: { type: string, nullable: true, example: Janey }
 *     SearchedUser:
 *       type: object
 *       description: User returned by the search endpoint, with an isContact flag.
 *       properties:
 *         _id: { type: string }
 *         fullName: { type: string }
 *         username: { type: string }
 *         avatar:
 *           type: object
 *           nullable: true
 *           properties:
 *             url: { type: string }
 *             public_id: { type: string }
 *         isContact: { type: boolean }
 *     ChatListItem:
 *       type: object
 *       description: A single item in the contact-based chat list.
 *       properties:
 *         user:
 *           type: object
 *           properties:
 *             _id: { type: string }
 *             fullName: { type: string }
 *             username: { type: string }
 *             avatar:
 *               type: object
 *               nullable: true
 *               properties:
 *                 url: { type: string }
 *             lastSeen: { type: string, format: date-time }
 *             showOnlineStatus: { type: boolean }
 *         lastMessage:
 *           nullable: true
 *           allOf:
 *             - $ref: '#/components/schemas/MessageView'
 *         unread: { type: integer, example: 3 }
 *
 * /contacts/search:
 *   get:
 *     tags: [Contacts]
 *     operationId: searchUsers
 *     summary: Search users by name, username, or email
 *     description: >
 *       Returns up to 20 matching users excluding yourself and blocked users.
 *       Each result includes an `isContact` flag. Requires at least 2 characters
 *       in the `q` query parameter; returns an empty array otherwise.
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema: { type: string, minLength: 2 }
 *         description: Search query (min 2 characters)
 *         example: jane
 *     responses:
 *       200:
 *         description: Search results (empty array if query is too short)
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
 *                         users:
 *                           type: array
 *                           items:
 *                             $ref: '#/components/schemas/SearchedUser'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *
 * /contacts/count:
 *   get:
 *     tags: [Contacts]
 *     operationId: getContactCount
 *     summary: Get total count of contacts
 *     description: Returns the total count of contacts saved by the authenticated user.
 *     responses:
 *       200:
 *         description: Contact count retrieved successfully
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
 *                         totalContacts: { type: integer, example: 42 }
 *                         count: { type: integer, example: 42 }
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *
 * /contacts/mutual/{otherUserId}:
 *   get:
 *     tags: [Contacts]
 *     operationId: getMutualContacts
 *     summary: Get mutual contacts with another user
 *     description: Returns the list of users who are saved as contacts by both the authenticated user and the other specified user.
 *     parameters:
 *       - in: path
 *         name: otherUserId
 *         required: true
 *         schema: { type: string }
 *         description: User ID of the other user
 *     responses:
 *       200:
 *         description: Mutual contacts retrieved successfully
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
 *                         mutualContacts:
 *                           type: array
 *                           items:
 *                             $ref: '#/components/schemas/ContactUser'
 *       400:
 *         $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *
 * /contacts/bulk:
 *   post:
 *     tags: [Contacts]
 *     operationId: bulkAddContacts
 *     summary: Bulk add contacts
 *     description: Adds multiple users to contacts in a single batch operation (up to 100 users).
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [contactIds]
 *             properties:
 *               contactIds:
 *                 type: array
 *                 items: { type: string }
 *                 maxItems: 100
 *                 example: ["665f1c2e9b1e8a0012a4b123", "665f1c2e9b1e8a0012a4b456"]
 *     responses:
 *       201:
 *         description: Bulk contacts processed successfully
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
 *                         addedCount: { type: integer, example: 2 }
 *                         skippedCount: { type: integer, example: 0 }
 *                         totalProcessed: { type: integer, example: 2 }
 *       400:
 *         $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *
 * /contacts:
 *   get:
 *     tags: [Contacts]
 *     operationId: getContacts
 *     summary: Get all contacts
 *     description: Returns the authenticated user's contact list, sorted by most recently added. Each contact includes their basic profile info and optional nickname.
 *     parameters:
 *       - in: query
 *         name: page
 *         required: false
 *         schema: { type: integer, minimum: 1, default: 1 }
 *         description: Page number for pagination
 *       - in: query
 *         name: limit
 *         required: false
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 50 }
 *         description: Number of items per page
 *       - in: query
 *         name: search
 *         required: false
 *         schema: { type: string }
 *         description: Filter contacts by nickname, name, or username
 *     responses:
 *       200:
 *         description: Contacts fetched successfully
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
 *                         contacts:
 *                           type: array
 *                           items:
 *                             $ref: '#/components/schemas/ContactUser'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *
 * /contacts/chats:
 *   get:
 *     tags: [Contacts]
 *     operationId: getChatList
 *     summary: Get contact-based chat list with last messages and unread counts
 *     description: >
 *       Returns only contacts who have exchanged at least one message with the
 *       current user (or all contacts sorted by latest activity). Messages deleted
 *       "for me" are excluded. Sorted by last message time descending.
 *     responses:
 *       200:
 *         description: Chat list fetched successfully
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
 *                         chats:
 *                           type: array
 *                           items:
 *                             $ref: '#/components/schemas/ChatListItem'
 *                         totalContacts:
 *                           type: integer
 *                           description: Total number of contacts (including those with no messages)
 *                           example: 12
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *
 * /contacts/{userId}:
 *   get:
 *     tags: [Contacts]
 *     operationId: getContactById
 *     summary: Get a single contact by user ID
 *     description: Fetches a single contact relationship for the authenticated user, returning profile info and nickname.
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string }
 *         description: MongoDB ObjectId of the contact
 *     responses:
 *       200:
 *         description: Contact fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/ContactUser'
 *       400:
 *         $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *   post:
 *     tags: [Contacts]
 *     operationId: addContact
 *     summary: Add a user to contacts
 *     description: >
 *       Creates a contact relationship from the current user to the target user.
 *       If the contact already exists, the operation is idempotent (no error).
 *       Optionally set a nickname for the contact.
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string }
 *         description: MongoDB ObjectId of the user to add
 *         example: 665f1c2e9b1e8a0012a4b123
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               nickname:
 *                 type: string
 *                 description: Optional display name override for this contact
 *                 example: Janey
 *     responses:
 *       201:
 *         description: Contact added successfully
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
 *         description: Invalid user ID, or trying to add yourself
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *   patch:
 *     tags: [Contacts]
 *     operationId: updateContactNickname
 *     summary: Update contact nickname
 *     description: Sets or updates the custom nickname for an existing contact.
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string }
 *         description: MongoDB ObjectId of the contact
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               nickname:
 *                 type: string
 *                 maxLength: 50
 *                 example: Janey
 *     responses:
 *       200:
 *         description: Contact nickname updated successfully
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
 *                         contactId: { type: string }
 *                         nickname: { type: string, nullable: true }
 *       400:
 *         $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *   delete:
 *     tags: [Contacts]
 *     operationId: removeContact
 *     summary: Remove a user from contacts
 *     description: Removes the contact relationship. Silently succeeds if the contact does not exist.
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string }
 *         description: MongoDB ObjectId of the contact to remove
 *         example: 665f1c2e9b1e8a0012a4b123
 *     responses:
 *       200:
 *         description: Contact removed successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       nullable: true
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
export {};
