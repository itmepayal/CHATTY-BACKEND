/**
 * @openapi
 * components:
 *   schemas:
 *     PublicKeyPayload:
 *       type: object
 *       description: User's public key information for end-to-end encryption.
 *       properties:
 *         publicKey:
 *           type: string
 *           description: Base64-encoded public key
 *         publicKeyUpdatedAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *
 * /users/me/public-key:
 *   put:
 *     tags: [Users]
 *     operationId: setMyPublicKey
 *     summary: Upload or replace my public key for E2EE
 *     description: >
 *       Stores the current user's public key used for end-to-end encryption
 *       key exchange. Call this whenever the client generates a new key pair.
 *       Rate limited to 20 changes per minute per user.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [publicKey]
 *             properties:
 *               publicKey:
 *                 type: string
 *                 description: Base64-encoded public key (e.g. RSA-OAEP 2048-bit)
 *                 example: MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A...
 *     responses:
 *       200:
 *         description: Public key saved
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/PublicKeyPayload'
 *       400:
 *         description: Missing or invalid public key
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *
 * /users/{id}/public-key:
 *   get:
 *     tags: [Users]
 *     operationId: getUserPublicKey
 *     summary: Get another user's public key for E2EE
 *     description: Fetches the stored public key for a given user. Used by the client to encrypt messages or group keys before sending.
 *     parameters:
 *       - $ref: '#/components/parameters/UserId'
 *     responses:
 *       200:
 *         description: Public key fetched
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/PublicKeyPayload'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         description: User not found, or user has no public key
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export {};
