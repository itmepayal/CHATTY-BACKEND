/**
 * @openapi
 * tags:
 *   name: E2EE
 *   description: Multi-device End-to-End Encryption key backup, restoration, and public key discovery
 *
 * components:
 *   schemas:
 *     ECPublicJwk:
 *       type: object
 *       required: [kty, crv, x, y]
 *       properties:
 *         kty: { type: string, example: EC }
 *         crv: { type: string, example: P-256 }
 *         x: { type: string, example: f83OJ3D2xFNT4MgTL3NtYTQVOBmGuyJM7AEurNWBf5o }
 *         y: { type: string, example: x_daftdaecAnRNOe0Ska-5XDmpST783dG772fFltN2k }
 *
 *     E2EEStatus:
 *       type: object
 *       properties:
 *         hasPublicKey: { type: boolean, example: true }
 *         hasBackup: { type: boolean, example: true }
 *         publicKeyUpdatedAt: { type: string, format: date-time, nullable: true }
 *         backupVersion: { type: integer, example: 1, nullable: true }
 *         backupUpdatedAt: { type: string, format: date-time, nullable: true }
 *
 *     E2EEKeyRegistration:
 *       type: object
 *       required: [publicKey, encryptedPrivateKey]
 *       properties:
 *         publicKey:
 *           $ref: '#/components/schemas/ECPublicJwk'
 *         encryptedPrivateKey:
 *           type: string
 *           description: Client-encrypted private key payload (stringified ciphertext or envelope)
 *           example: "eyJpdiI6IlhYZXMiLCJjaXBoZXIiOiJkR2hsY3k..."
 *         backupVersion:
 *           type: integer
 *           default: 1
 *           example: 1
 *
 *     E2EEBackupPayload:
 *       type: object
 *       properties:
 *         encryptedPrivateKey: { type: string }
 *         backupVersion: { type: integer, example: 1 }
 *         backupUpdatedAt: { type: string, format: date-time, nullable: true }
 *         publicKey: { $ref: '#/components/schemas/ECPublicJwk' }
 *
 *     E2EEResetRequest:
 *       type: object
 *       required: [password, confirm]
 *       properties:
 *         password: { type: string, example: "Secret123!" }
 *         confirm: { type: string, example: "RESET_E2EE_IDENTITY" }
 *
 * /e2ee/status:
 *   get:
 *     tags: [E2EE]
 *     summary: Get user E2EE public key and backup status
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: E2EE status
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/E2EEStatus'
 *
 * /e2ee/keys:
 *   post:
 *     tags: [E2EE]
 *     summary: Register initial public key and encrypted private key backup
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/E2EEKeyRegistration'
 *     responses:
 *       201:
 *         description: Keys and backup registered successfully
 *       409:
 *         description: Public key already exists for this account
 *
 * /e2ee/backup:
 *   get:
 *     tags: [E2EE]
 *     summary: Retrieve encrypted private key backup
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Encrypted key backup returned
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/E2EEBackupPayload'
 *       404:
 *         description: No backup found
 *   put:
 *     tags: [E2EE]
 *     summary: Update encrypted private key backup without altering public key
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [encryptedPrivateKey]
 *             properties:
 *               encryptedPrivateKey: { type: string }
 *               backupVersion: { type: integer, example: 2 }
 *     responses:
 *       200:
 *         description: Backup updated
 *
 * /e2ee/reset:
 *   post:
 *     tags: [E2EE]
 *     summary: Reset E2EE identity and backups
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/E2EEResetRequest'
 *     responses:
 *       200:
 *         description: E2EE identity reset successfully
 *
 * /messages/e2ee/public-key/{id}:
 *   get:
 *     tags: [E2EE]
 *     summary: Fetch public key of a specific user
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Public key found
 *       404:
 *         description: User or key not found
 *
 * /messages/e2ee/public-keys:
 *   post:
 *     tags: [E2EE]
 *     summary: Batch fetch public keys for multiple users
 *     security:
 *       - bearerAuth: []
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
 *                 items: { type: string }
 *     responses:
 *       200:
 *         description: List of user public keys
 */
