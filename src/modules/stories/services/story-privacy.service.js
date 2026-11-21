import User from "../../users/models/users.model.js";
import Contact from "../../contacts/models/contact.model.js";

/**
 * Checks whether viewerId is authorized to view a specific story.
 * @param {Object} story - The story mongoose document or object
 * @param {string|mongoose.Types.ObjectId} viewerId - The user attempting to view
 * @returns {Promise<boolean>}
 */
export const canUserViewStory = async (story, viewerId) => {
  if (!story || !viewerId) return false;

  const ownerIdStr = String(story.userId?._id || story.userId);
  const viewerIdStr = String(viewerId);

  // Story owner can always view their own story
  if (ownerIdStr === viewerIdStr) {
    return true;
  }

  // Check if either user has blocked the other
  const isBlocked = await User.exists({
    $or: [
      { _id: ownerIdStr, blockedUsers: viewerIdStr },
      { _id: viewerIdStr, blockedUsers: ownerIdStr },
    ],
  });

  if (isBlocked) {
    return false;
  }

  const privacy = story.privacy || "contacts";

  switch (privacy) {
    case "everyone":
      return true;

    case "contacts": {
      const isAContact = await Contact.exists({
        ownerId: ownerIdStr,
        contactId: viewerIdStr,
      });
      return Boolean(isAContact);
    }

    case "custom": {
      const allowed = Array.isArray(story.allowedViewers)
        ? story.allowedViewers.map((id) => String(id?._id || id))
        : [];
      return allowed.includes(viewerIdStr);
    }

    case "excluded": {
      const excluded = Array.isArray(story.excludedViewers)
        ? story.excludedViewers.map((id) => String(id?._id || id))
        : [];
      return !excluded.includes(viewerIdStr);
    }

    default:
      return false;
  }
};
