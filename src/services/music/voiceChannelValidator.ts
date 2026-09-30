import { PermissionFlagsBits, type Client, type GuildMember, type VoiceBasedChannel } from "discord.js";
import Logger from "../../helpers/Logger.js";

/**
 * Validates that the bot can join and speak in a voice channel.
 * Checks ViewChannel, Connect, and Speak permissions, and member limits.
 * Throws with a descriptive error if any check fails.
 */
export function validateVoiceChannelAccess(channel: VoiceBasedChannel, botMember: GuildMember): void {
  const permissions = channel.permissionsFor(botMember);
  if (!permissions) return;

  if (!permissions.has(PermissionFlagsBits.ViewChannel)) {
    throw new Error(`I do not have permission to view your voice channel (${channel.name}).`);
  }
  if (!permissions.has(PermissionFlagsBits.Connect)) {
    throw new Error(`I do not have permission to join your voice channel (${channel.name}) (missing 'Connect' permission).`);
  }
  if (!permissions.has(PermissionFlagsBits.Speak)) {
    throw new Error(`I do not have permission to speak in your voice channel (${channel.name}) (missing 'Speak' permission).`);
  }

  const botAlreadyInChannel = channel.members.has(botMember.id);
  const isFull = channel.userLimit > 0 && channel.members.size >= channel.userLimit;
  const canBypassLimit =
    permissions.has(PermissionFlagsBits.MoveMembers) ||
    permissions.has(PermissionFlagsBits.Administrator);

  if (!botAlreadyInChannel && isFull && !canBypassLimit) {
    throw new Error(`Cannot join ${channel.name} because it is full (${channel.members.size}/${channel.userLimit} members).`);
  }
}
