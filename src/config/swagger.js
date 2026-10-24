import swaggerJSDoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import { swaggerEnabled, swaggerServerUrl } from "../constants/constant.js";

const objectId = (example = "665f1c2e9b1e8a0012a4b123") => ({
  type: "string",
  example,
});

const imageAttachment = {
  type: "object",
  properties: {
    public_id: { type: "string" },
    url: { type: "string", example: "https://res.cloudinary.com/.../img.jpg" },
  },
};

const fileAttachment = {
  type: "object",
  properties: {
    public_id: { type: "string" },
    url: { type: "string" },
    name: { type: "string", example: "report.pdf" },
    size: { type: "number", example: 204800 },
    mimeType: { type: "string", example: "application/pdf" },
    resourceType: { type: "string", example: "raw" },
  },
};

const audioAttachment = {
  type: "object",
  properties: {
    public_id: { type: "string" },
    url: { type: "string" },
    duration: { type: "number", example: 12.5 },
    mimeType: { type: "string", example: "audio/webm" },
    resourceType: { type: "string", example: "video" },
  },
};

const errorResponse = (description) => ({
  description,
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/ErrorResponse" },
    },
  },
});

const options = {
  definition: {
    openapi: "3.0.3",
    info: {
      title: "Chat App API",
      version: "1.0.0",
      description: "API documentation for the chat application.",
    },
    servers: [
      {
        url: swaggerServerUrl,
        description:
          process.env.NODE_ENV === "production"
            ? "Production Server"
            : "Local Development Server",
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
      parameters: {
        UserId: {
          in: "path",
          name: "id",
          required: true,
          schema: { type: "string" },
          description: "MongoDB ObjectId of the user",
        },
        GroupId: {
          in: "path",
          name: "groupId",
          required: true,
          schema: { type: "string" },
          description: "MongoDB ObjectId of the group",
        },
        MessageId: {
          in: "path",
          name: "messageId",
          required: true,
          schema: { type: "string" },
          description: "MongoDB ObjectId of the message",
        },
        SessionId: {
          in: "path",
          name: "sessionId",
          required: true,
          schema: { type: "string" },
          description: "MongoDB ObjectId of the session",
        },
        Page: {
          in: "query",
          name: "page",
          schema: { type: "integer", minimum: 1, default: 1 },
        },
        Limit: {
          in: "query",
          name: "limit",
          schema: { type: "integer", minimum: 1, maximum: 100, default: 20 },
        },
      },
      schemas: {
        User: {
          type: "object",
          properties: {
            _id: objectId(),
            id: objectId(),
            email: { type: "string", example: "jane@example.com" },
            fullName: { type: "string", example: "Jane Doe" },
            username: { type: "string", example: "jane_doe" },
            phone: { type: "string", example: "+91 98765 43210" },
            gender: {
              type: "string",
              enum: ["Female", "Male", "Other", "Prefer not to say", ""],
            },
            dob: { type: "string", format: "date" },
            location: { type: "string", example: "Ahmedabad" },
            website: { type: "string", example: "https://example.com" },
            bio: { type: "string", example: "Hello there!" },
            timezone: { type: "string", example: "Asia/Kolkata" },
            avatar: imageAttachment,
            blockedUsers: { type: "array", items: { type: "string" } },
            favorites: { type: "array", items: { type: "string" } },
            lastSeen: { type: "string", format: "date-time" },
            twoFactorEnabled: { type: "boolean" },
            loginAlerts: { type: "boolean" },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
        PrivacySettings: {
          type: "object",
          properties: {
            showOnlineStatus: { type: "boolean" },
            readReceipts: { type: "boolean" },
            typingIndicator: { type: "boolean" },
          },
        },
        ChatPrefs: {
          type: "object",
          properties: {
            enterToSend: { type: "boolean" },
            largeEmoji: { type: "boolean" },
            autoScroll: { type: "boolean" },
          },
        },
        Appearance: {
          type: "object",
          properties: {
            theme: { type: "string", example: "light" },
            fontSize: { type: "string", enum: ["sm", "md", "lg"] },
            bubbleStyle: {
              type: "string",
              enum: ["rounded", "soft", "sharp"],
            },
            density: { type: "string", enum: ["comfortable", "compact"] },
            showTimestamps: { type: "boolean" },
            timeFormat: { type: "string", enum: ["12h", "24h"] },
          },
        },

        Session: {
          type: "object",
          properties: {
            id: objectId(),
            device: { type: "string", example: "MacBook Pro" },
            browser: { type: "string", example: "Chrome" },
            os: { type: "string", example: "macOS" },
            deviceType: { type: "string", example: "desktop" },
            location: { type: "string", example: "Ahmedabad, IN" },
            lastActivity: { type: "string", format: "date-time" },
            createdAt: { type: "string", format: "date-time" },
            lastActiveLabel: { type: "string", example: "5 minutes ago" },
            current: { type: "boolean" },
          },
        },

        ImageAttachment: imageAttachment,
        FileAttachment: fileAttachment,
        AudioAttachment: audioAttachment,

        Reaction: {
          type: "object",
          properties: {
            userId: objectId(),
            emoji: { type: "string", example: "👍" },
          },
          required: ["userId", "emoji"],
        },
        Message: {
          type: "object",
          properties: {
            _id: objectId(),
            senderId: objectId(),
            receiverId: objectId(),
            text: { type: "string", example: "Hey, how are you?" },
            image: { $ref: "#/components/schemas/ImageAttachment" },
            file: { $ref: "#/components/schemas/FileAttachment" },
            audio: { $ref: "#/components/schemas/AudioAttachment" },
            clientId: {
              type: "string",
              description: "Client-generated id used to de-duplicate sends",
            },
            reactions: {
              type: "array",
              items: { $ref: "#/components/schemas/Reaction" },
            },
            deletedFor: { type: "array", items: { type: "string" } },
            isDeleted: { type: "boolean", default: false },
            deletedAt: { type: "string", format: "date-time", nullable: true },
            status: {
              type: "string",
              enum: ["sent", "delivered", "seen"],
              default: "sent",
            },
            deliveredAt: { type: "string", format: "date-time" },
            seenAt: { type: "string", format: "date-time" },
            receiverReadAt: {
              type: "string",
              format: "date-time",
              nullable: true,
            },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
        SendMessageRequest: {
          type: "object",
          description: "Provide text and/or one attachment.",
          properties: {
            text: { type: "string" },
            image: { type: "string", format: "binary" },
            file: { type: "string", format: "binary" },
            audio: { type: "string", format: "binary" },
            clientId: { type: "string" },
          },
        },

        // ----- Groups -----
        GroupMember: {
          type: "object",
          properties: {
            userId: objectId(),
            role: {
              type: "string",
              enum: ["admin", "member"],
              default: "member",
            },
            joinedAt: { type: "string", format: "date-time" },
          },
        },
        Group: {
          type: "object",
          properties: {
            _id: objectId(),
            name: {
              type: "string",
              minLength: 2,
              maxLength: 50,
              example: "Project Team",
            },
            avatar: imageAttachment,
            owner: objectId(),
            members: {
              type: "array",
              items: { $ref: "#/components/schemas/GroupMember" },
            },
            lastMessageAt: { type: "string", format: "date-time" },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
        CreateGroupRequest: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string", minLength: 2, maxLength: 50 },
            members: {
              type: "array",
              items: { type: "string" },
              description: "User ids to add",
            },
            avatar: { type: "string", format: "binary" },
          },
        },
        GroupMessage: {
          type: "object",
          properties: {
            _id: objectId(),
            groupId: objectId(),
            senderId: objectId(),
            text: { type: "string", maxLength: 2000 },
            image: { $ref: "#/components/schemas/ImageAttachment" },
            file: { $ref: "#/components/schemas/FileAttachment" },
            audio: { $ref: "#/components/schemas/AudioAttachment" },
            clientId: { type: "string" },
            readBy: { type: "array", items: { type: "string" } },
            silentReadBy: { type: "array", items: { type: "string" } },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },

        ApiResponse: {
          type: "object",
          properties: {
            statusCode: { type: "integer", example: 200 },
            data: { type: "object", nullable: true },
            message: { type: "string" },
            success: { type: "boolean", example: true },
          },
        },
        ErrorResponse: {
          type: "object",
          properties: {
            statusCode: { type: "integer", example: 400 },
            message: { type: "string", example: "Something went wrong." },
            success: { type: "boolean", example: false },
          },
        },
      },
      responses: {
        BadRequest: errorResponse("Validation error"),
        Unauthorized: errorResponse("User not authenticated"),
        Forbidden: errorResponse("You don't have permission"),
        NotFound: errorResponse("Resource not found"),
        Conflict: errorResponse("Conflict with existing resource"),
      },
    },
    security: [{ bearerAuth: [] }],
    tags: [
      { name: "Auth", description: "Register, login, tokens, 2FA" },
      {
        name: "Users",
        description: "Profile, privacy, preferences, relations",
      },
      { name: "Sessions", description: "Manage active login sessions" },
      { name: "Messages", description: "Direct (1-to-1) messages" },
      { name: "Groups", description: "Groups and group messages" },
      { name: "AI", description: "AI assistant endpoints" },
    ],
  },
  apis: ["./src/docs/*.js", "./src/routes/**/*.js"],
};

const swaggerSpec = swaggerJSDoc(options);

export const setupSwagger = (app) => {
  app.use(
    "/api-docs",
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec, {
      explorer: true,
      swaggerOptions: { persistAuthorization: true },
    }),
  );
  app.get("/api-docs.json", (_req, res) => res.json(swaggerSpec));
};

export default swaggerSpec;
