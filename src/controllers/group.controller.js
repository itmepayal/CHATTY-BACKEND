import { StatusCodes } from "http-status-codes";
import asyncHandler from "../middlewares/asyncHandler.middleware.js";
import ApiError from "../utils/api-error.js";
import ApiResponse from "../utils/api-response.js";
import GroupMessage from "../models/group-message.model.js";
import GroupArchive from "../models/group-archive.model.js";
import LocationShare from "../models/location-share.model.js";
import { deleteFileToCloudinary } from "../config/cloudinary.config.js";
import { io, groupRoom, getPrivacy } from "../lib/socket.js";
import {
  getGroupAndMember,
  assertAdmin,
  getBlockedByMe,
  getBlockersOf,
} from "../utils/group-guard.js";
import { parseKeyEntries, parseBool } from "../utils/e2ee.js";
import { toNum, readClientId, parseIds } from "../utils/validators.js";
import {
  sid,
  loadGroup,
  presentGroup,
  emitToMembers,
  broadcastGroupMessage,
  deleteMedia,
  destroyGroup,
  getMyGroupsList,
  getGroupMessagesList,
  markGroupMessagesSeen,
  validateGroupMessageInput,
  findGroupMessageDuplicate,
} from "../services/group.service.js";
import { uploadImage, uploadAttachment } from "../services/group-media.service.js";
import {
  validateInitialKeyEntries,
  getMyKeysPayload,
  getPendingKeyMembersPayload,
  applyGroupKeys,
} from "../services/group-key.service.js";
import {
  createGroupWithMembers,
  addMembersToGroup,
  removeMemberFromGroup,
  changeMemberRole,
  leaveGroupFlow,
} from "../services/group-member.service.js";
import {
  startCurrentShare,
  updateShare,
  stopShare,
  getActiveSharesFor,
  formatGroupMessage,
} from "../services/group-share.service.js";
import { validName } from "../utils/group-validators.js";
import { MAX_GROUP_MEMBERS } from "../constants/constants.js";

const groupController = {
  createGroup: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const name = req.body.name?.trim();
    validName(name);

    const memberIds = parseIds(req.body.memberIds).filter(
      (id) => id !== String(me),
    );
    if (!memberIds.length) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Add at least one member.");
    }
    if (memberIds.length + 1 > MAX_GROUP_MEMBERS) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        `A group can have at most ${MAX_GROUP_MEMBERS} members.`,
      );
    }

    const wantsE2EE = parseBool(req.body.e2ee);
    let keyEntries = [];
    if (wantsE2EE) {
      keyEntries = parseKeyEntries(req.body.keys, 1);
      validateInitialKeyEntries({ keyEntries, me, memberIds });
    }

    const avatar = req.file?.path ? await uploadImage(req.file) : undefined;

    const payload = await createGroupWithMembers({
      me,
      name,
      memberIds,
      avatar,
      wantsE2EE,
      keyEntries,
    });

    return new ApiResponse(StatusCodes.CREATED, payload, "Group created.").send(
      res,
    );
  }),

  getMyGroups: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const result = await getMyGroupsList(me);
    return new ApiResponse(StatusCodes.OK, result, "Groups fetched.").send(res);
  }),

  getGroup: asyncHandler(async (req, res) => {
    const me = req.user._id;
    await getGroupAndMember(req.params.id, me);
    const group = await loadGroup(req.params.id);
    const archived = !!(await GroupArchive.exists({
      ownerId: me,
      groupId: group._id,
    }));
    return new ApiResponse(
      StatusCodes.OK,
      await presentGroup(group, { archived }),
      "Group fetched.",
    ).send(res);
  }),

  archiveGroup: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const { group } = await getGroupAndMember(req.params.id, me);

    await GroupArchive.updateOne(
      { ownerId: me, groupId: group._id },
      { $setOnInsert: { ownerId: me, groupId: group._id } },
      { upsert: true },
    );

    const payload = { groupId: String(group._id), archived: true };
    io.to(String(me)).emit("group:archiveChanged", payload);

    return new ApiResponse(StatusCodes.OK, payload, "Group archived.").send(
      res,
    );
  }),

  unarchiveGroup: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const { group } = await getGroupAndMember(req.params.id, me);

    await GroupArchive.deleteOne({ ownerId: me, groupId: group._id });

    const payload = { groupId: String(group._id), archived: false };
    io.to(String(me)).emit("group:archiveChanged", payload);

    return new ApiResponse(StatusCodes.OK, payload, "Group unarchived.").send(
      res,
    );
  }),

  updateGroup: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const { group, member } = await getGroupAndMember(req.params.id, me);
    assertAdmin(member);

    let changed = false;
    let oldPublicId;

    if (req.body.name !== undefined) {
      const name = String(req.body.name).trim();
      validName(name);
      if (name !== group.name) {
        group.name = name;
        changed = true;
      }
    }

    if (req.file?.path) {
      oldPublicId = group.avatar?.public_id;
      group.avatar = await uploadImage(req.file);
      changed = true;
    }

    if (!changed) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "No changes to update.");
    }

    await group.save();
    if (oldPublicId) await deleteFileToCloudinary(oldPublicId).catch(() => { });

    const full = await loadGroup(group._id);
    const payload = await presentGroup(full);
    emitToMembers(full, "group:updated", payload);

    return new ApiResponse(StatusCodes.OK, payload, "Group updated.").send(res);
  }),

  addMembers: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const { group, member } = await getGroupAndMember(req.params.id, me);
    assertAdmin(member);

    const payload = await addMembersToGroup({
      group,
      me,
      rawMemberIds: req.body.memberIds,
    });

    return new ApiResponse(StatusCodes.OK, payload, "Members added.").send(res);
  }),

  removeMember: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const targetId = req.params.userId;
    const { group, member } = await getGroupAndMember(req.params.id, me);
    assertAdmin(member);

    const payload = await removeMemberFromGroup({ group, me, targetId });

    return new ApiResponse(StatusCodes.OK, payload, "Member removed.").send(
      res,
    );
  }),

  changeRole: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const targetId = req.params.userId;
    const { role } = req.body;
    const { group, member } = await getGroupAndMember(req.params.id, me);
    assertAdmin(member);

    const payload = await changeMemberRole({ group, me, targetId, role });

    return new ApiResponse(StatusCodes.OK, payload, "Role updated.").send(res);
  }),

  leaveGroup: asyncHandler(async (req, res) => {
    const me = String(req.user._id);
    const { group } = await getGroupAndMember(req.params.id, me);

    const { destroyed } = await leaveGroupFlow({ group, me });

    if (destroyed) {
      return new ApiResponse(
        StatusCodes.OK,
        null,
        "You left. The group was deleted.",
      ).send(res);
    }

    return new ApiResponse(StatusCodes.OK, null, "You left the group.").send(
      res,
    );
  }),

  deleteGroup: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const { group } = await getGroupAndMember(req.params.id, me);

    if (sid(group.owner) !== String(me)) {
      throw new ApiError(
        StatusCodes.FORBIDDEN,
        "Only the group owner can delete the group.",
      );
    }

    const payload = { groupId: String(group._id) };
    emitToMembers(group, "group:deleted", payload);
    io.in(groupRoom(group._id)).socketsLeave(groupRoom(group._id));

    await destroyGroup(group);

    return new ApiResponse(StatusCodes.OK, payload, "Group deleted.").send(res);
  }),

  getMyGroupKeys: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const { group } = await getGroupAndMember(req.params.id, me);

    const data = await getMyKeysPayload(group, me);

    return new ApiResponse(StatusCodes.OK, data, "Group keys fetched.").send(
      res,
    );
  }),

  getPendingKeyMembers: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const { group } = await getGroupAndMember(req.params.id, me);

    const result = await getPendingKeyMembersPayload(group);

    if (result.notEncrypted) {
      return new ApiResponse(
        StatusCodes.OK,
        { latestVersion: result.latestVersion, pending: result.pending },
        "Group is not encrypted.",
      ).send(res);
    }

    return new ApiResponse(
      StatusCodes.OK,
      { latestVersion: result.latestVersion, pending: result.pending },
      "Pending key members fetched.",
    ).send(res);
  }),

  setGroupKeys: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const { group, member } = await getGroupAndMember(req.params.id, me);

    const entries = parseKeyEntries(req.body.keys, toNum(req.body.version));

    const { latestVersion, stored, isNewVersion, latest } = await applyGroupKeys({
      group,
      member,
      entries,
      me,
    });

    return new ApiResponse(
      StatusCodes.OK,
      { latestVersion, stored },
      isNewVersion && latest === 0
        ? "Encryption enabled for this group."
        : "Group keys saved.",
    ).send(res);
  }),

  getGroupMessages: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const { group, member } = await getGroupAndMember(req.params.id, me);

    const msgs = await getGroupMessagesList(group, member, me, req.query);

    return new ApiResponse(
      StatusCodes.OK,
      msgs,
      "Group messages fetched.",
    ).send(res);
  }),

  sendGroupMessage: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const { group } = await getGroupAndMember(req.params.id, me);

    const { text, cipher, isVoice, isVideo } = await validateGroupMessageInput(
      group,
      me,
      req.body,
      req.file,
    );

    const clientId = readClientId(req.body);

    if (clientId) {
      const dup = await findGroupMessageDuplicate(group._id, me, clientId);
      if (dup) {
        return new ApiResponse(
          StatusCodes.OK,
          formatGroupMessage(dup),
          "Message already sent.",
        ).send(res);
      }
    }

    const attachment = req.file?.path
      ? await uploadAttachment(req.file, {
        isVoice,
        isVideo,
        duration: req.body.duration,
      })
      : {};

    let message;
    try {
      message = await GroupMessage.create({
        groupId: group._id,
        senderId: me,
        text,
        ...attachment,
        ...cipher,
        clientId,
        readBy: [me],
      });
    } catch (error) {
      await Promise.allSettled(deleteMedia(attachment));

      if (error?.code === 11000 && clientId) {
        const dup = await findGroupMessageDuplicate(group._id, me, clientId);
        if (dup) {
          return new ApiResponse(
            StatusCodes.OK,
            formatGroupMessage(dup),
            "Message already sent.",
          ).send(res);
        }
      }
      throw error;
    }

    const payload = await broadcastGroupMessage(group, message, me);

    return new ApiResponse(StatusCodes.CREATED, payload, "Message sent.").send(
      res,
    );
  }),

  markGroupSeen: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const { group, member } = await getGroupAndMember(req.params.id, me);
    const { readReceipts } = getPrivacy(me);

    const { count } = await markGroupMessagesSeen(group, member, me, readReceipts);

    return new ApiResponse(
      StatusCodes.OK,
      { count },
      "Messages marked as seen.",
    ).send(res);
  }),

  startGroupShare: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const { group } = await getGroupAndMember(req.params.id, me);

    const respondDuplicate = async (dup, mode) => {
      const message = formatGroupMessage(dup);
      if (mode === "live" && dup.location?.shareId) {
        const share = await LocationShare.findById(dup.location.shareId);
        return new ApiResponse(
          StatusCodes.OK,
          { message, share },
          "Live location already started.",
        ).send(res);
      }
      return new ApiResponse(
        StatusCodes.OK,
        message,
        "Location already sent.",
      ).send(res);
    };

    const result = await startCurrentShare({ group, me, body: req.body, file: req.file });

    if (result.duplicate) {
      return respondDuplicate(result.dup, result.mode);
    }

    if (result.mode === "current") {
      return new ApiResponse(
        StatusCodes.CREATED,
        result.payload,
        "Location sent.",
      ).send(res);
    }

    // live
    return new ApiResponse(
      StatusCodes.CREATED,
      { message: result.payload, share: result.share },
      "Live location started.",
    ).send(res);
  }),

  updateGroupShare: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const { shareId } = req.params;
    const { group } = await getGroupAndMember(req.params.id, me);

    const result = await updateShare({ group, me, shareId, body: req.body });

    if (result.skipped) {
      return new ApiResponse(
        StatusCodes.OK,
        { shareId: result.shareId, skipped: true },
        "Update skipped (too frequent).",
      ).send(res);
    }

    return new ApiResponse(StatusCodes.OK, result.locationPayload, "Location updated.").send(
      res,
    );
  }),

  stopGroupShare: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const { shareId } = req.params;
    const { group } = await getGroupAndMember(req.params.id, me);

    const { shareId: resultShareId } = await stopShare({ group, me, shareId });

    return new ApiResponse(
      StatusCodes.OK,
      { shareId: resultShareId },
      "Live location stopped.",
    ).send(res);
  }),

  getActiveGroupShares: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const { group } = await getGroupAndMember(req.params.id, me);
    const blocked = await getBlockedByMe(me);

    const { mine, inGroup } = await getActiveSharesFor({
      group,
      me,
      blocked,
      getBlockersOf,
    });

    return new ApiResponse(
      StatusCodes.OK,
      { mine, inGroup },
      "Active location shares.",
    ).send(res);
  }),
};

export default groupController;
