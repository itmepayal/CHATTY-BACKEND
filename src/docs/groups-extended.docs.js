/**
 * @openapi
 * components:
 *   schemas:
 *     GroupKeyEntry:
 *       type: object
 *       description: A wrapped group encryption key entry for one member.
 *       properties:
 *         userId: { type: string }
 *         encryptedKey: { type: string, description: Base64-encoded wrapped key }
 *     GroupLocationShareRecord:
 *       type: object
 *       description: An active group live location share session.
 *       properties:
 *         _id: { type: string }
 *         sharerId: { type: string }
 *         groupId: { type: string }
 *         status:
 *           type: string
 *           enum: [active, stopped, expired]
 *         expiresAt: { type: string, format: date-time }
 *         lastLocation:
 *           type: object
 *           properties:
 *             lat: { type: number, example: 23.0225 }
 *             lng: { type: number, example: 72.5714 }
 *             accuracy: { type: number, nullable: true }
 *             updatedAt: { type: string, format: date-time }
 *
 * /groups/{groupId}/archive:
 *   put:
 *     tags: [Groups]
 *     operationId: archiveGroup
 *     summary: Archive a group
 *     description: Archives the group for the current user only. Other members are not affected. Rate limited to 20 changes per minute per user.
 *     parameters:
 *       - $ref: '#/components/parameters/GroupId'
 *     responses:
 *       200:
 *         description: Group archived
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
 *                         groupId: { type: string }
 *                         archived: { type: boolean, example: true }
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *   delete:
 *     tags: [Groups]
 *     operationId: unarchiveGroup
 *     summary: Unarchive a group
 *     description: Removes the archived status for the current user only.
 *     parameters:
 *       - $ref: '#/components/parameters/GroupId'
 *     responses:
 *       200:
 *         description: Group unarchived
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
 *                         groupId: { type: string }
 *                         archived: { type: boolean, example: false }
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *
 * /groups/{groupId}/keys:
 *   get:
 *     tags: [Groups]
 *     operationId: getMyGroupKeys
 *     summary: Get the current user's group encryption keys
 *     description: >
 *       Returns the encrypted group keys stored for the current user across all
 *       key versions. Only members of the group can call this endpoint. Used by
 *       clients implementing E2EE group messaging.
 *     parameters:
 *       - $ref: '#/components/parameters/GroupId'
 *     responses:
 *       200:
 *         description: Group keys fetched
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
 *                       description: Map of key version to encrypted key material for this user
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *   post:
 *     tags: [Groups]
 *     operationId: setGroupKeys
 *     summary: Store group encryption keys for members
 *     description: >
 *       Uploads wrapped encryption keys for one or more group members. Called when
 *       enabling encryption on a group or when new members are added. Members can
 *       only write keys for members who need them. Rate limited to 20 writes per
 *       minute per user.
 *     parameters:
 *       - $ref: '#/components/parameters/GroupId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [keys]
 *             properties:
 *               keys:
 *                 type: array
 *                 items:
 *                   $ref: '#/components/schemas/GroupKeyEntry'
 *                 description: Array of per-member wrapped key entries
 *               version:
 *                 type: integer
 *                 description: Key version number (for key rotation)
 *     responses:
 *       200:
 *         description: Group keys saved (or encryption enabled if this is the first upload)
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
 *                         latestVersion: { type: integer }
 *                         stored: { type: integer, description: Number of keys stored }
 *       400:
 *         description: Invalid key entries
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
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *
 * /groups/{groupId}/keys/pending:
 *   get:
 *     tags: [Groups]
 *     operationId: getPendingKeyMembers
 *     summary: Get members who are missing group encryption keys
 *     description: >
 *       Returns the list of group members who do not yet have a wrapped key
 *       for the latest key version. Used by admins to discover which members
 *       still need keys distributed to them.
 *     parameters:
 *       - $ref: '#/components/parameters/GroupId'
 *     responses:
 *       200:
 *         description: Pending key members (or note that group is not encrypted)
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
 *                         latestVersion:
 *                           type: integer
 *                           nullable: true
 *                         pending:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               userId: { type: string }
 *                               fullName: { type: string }
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *
 * /groups/{groupId}/location:
 *   post:
 *     tags: [Location]
 *     operationId: startGroupShare
 *     summary: Share current location or start live location in a group
 *     description: >
 *       Two modes: **current** (one-time snapshot message) or **live** (session
 *       with auto-expiry). Rate limited to 20 requests per minute per user.
 *       Duplicate clientId protection is applied.
 *     parameters:
 *       - $ref: '#/components/parameters/GroupId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [mode, lat, lng]
 *             properties:
 *               mode:
 *                 type: string
 *                 enum: [current, live]
 *               lat: { type: number, format: double, example: 23.0225 }
 *               lng: { type: number, format: double, example: 72.5714 }
 *               accuracy: { type: number, nullable: true, example: 10.0 }
 *               durationMin:
 *                 type: integer
 *                 enum: [15, 60, 480]
 *                 description: Required for live mode
 *               clientId:
 *                 type: string
 *                 description: Client-generated idempotency key
 *     responses:
 *       201:
 *         description: Location sent (current) or live session started
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       200:
 *         description: Location or live share already initiated (duplicate clientId)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *
 * /groups/{groupId}/location/active:
 *   get:
 *     tags: [Location]
 *     operationId: getActiveGroupShares
 *     summary: Get active live location shares in a group
 *     description: Returns two lists - the current user's active shares in this group (`mine`) and all other active shares visible to this user in the group (`inGroup`), excluding shares from blocked users.
 *     parameters:
 *       - $ref: '#/components/parameters/GroupId'
 *     responses:
 *       200:
 *         description: Active group location shares
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
 *                             $ref: '#/components/schemas/GroupLocationShareRecord'
 *                         inGroup:
 *                           type: array
 *                           items:
 *                             $ref: '#/components/schemas/GroupLocationShareRecord'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *
 * /groups/{groupId}/location/{shareId}:
 *   patch:
 *     tags: [Location]
 *     operationId: updateGroupShare
 *     summary: Update live location coordinates for a group share
 *     description: >
 *       Updates the position of an active group live location share. Updates
 *       arriving more frequently than every 2 seconds are silently skipped to
 *       prevent flooding. Emits a `group:location:update` Socket.IO event.
 *     parameters:
 *       - $ref: '#/components/parameters/GroupId'
 *       - in: path
 *         name: shareId
 *         required: true
 *         schema: { type: string }
 *         description: MongoDB ObjectId of the active LocationShare
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [lat, lng]
 *             properties:
 *               lat: { type: number, format: double, example: 23.0226 }
 *               lng: { type: number, format: double, example: 72.5715 }
 *               accuracy: { type: number, nullable: true, example: 8.0 }
 *     responses:
 *       200:
 *         description: Location updated (or skipped if too frequent)
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       oneOf:
 *                         - type: object
 *                           properties:
 *                             shareId: { type: string }
 *                             skipped: { type: boolean, example: true }
 *                         - type: object
 *                           properties:
 *                             shareId: { type: string }
 *                             lat: { type: number }
 *                             lng: { type: number }
 *                             accuracy: { type: number }
 *                             updatedAt: { type: string, format: date-time }
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *
 * /groups/{groupId}/location/{shareId}/stop:
 *   post:
 *     tags: [Location]
 *     operationId: stopGroupShare
 *     summary: Stop an active group live location share
 *     description: Stops a group live location session started by the current user. Emits `group:location:ended` to all group members. Rate limited to 20 requests per minute per user.
 *     parameters:
 *       - $ref: '#/components/parameters/GroupId'
 *       - in: path
 *         name: shareId
 *         required: true
 *         schema: { type: string }
 *         description: MongoDB ObjectId of the active LocationShare
 *     responses:
 *       200:
 *         description: Live group location stopped
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
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
export {};
