import { describe, expect, it, vi } from "vitest";
import { Collection, PermissionFlagsBits, PermissionsBitField } from "discord.js";
import {
  assertVoiceChannelJoinable,
  formatMusicError,
  parseTimestamp,
  requireVoiceChannel,
} from "../src/services/music/commandHelpers.js";

const { mockYoutubeDl } = vi.hoisted(() => ({
  mockYoutubeDl: vi.fn(),
}));

vi.mock("youtube-dl-exec", () => ({
  youtubeDl: (...args: unknown[]) => mockYoutubeDl(...args),
}));

import YtDlpResolver from "../src/services/music/YtDlpResolver.js";

describe("parseTimestamp", () => {
  it.each([["90", 90_000], ["1:30", 90_000], ["1:02:30", 3_750_000]])("parses %s", (value, expected) => {
    expect(parseTimestamp(value)).toBe(expected);
  });
  it.each(["", "1:2:3:4", "hello", "-1"])("rejects %s", (value) => {
    expect(() => parseTimestamp(value)).toThrow();
  });
});

describe("YtDlpResolver", () => {
  it("resolves query and does not pass noCheckCertificates: false", async () => {
    let capturedTarget = "";
    let capturedOptions: Record<string, unknown> | null = null;
    mockYoutubeDl.mockImplementation((target: string, options: Record<string, unknown>) => {
      capturedTarget = target;
      capturedOptions = options;
      return Promise.resolve({
        id: "test12345",
        title: "Shadow",
        uploader: "Gagan Likhari",
        duration: 180,
        webpage_url: "https://www.youtube.com/watch?v=test12345",
      });
    });

    const resolver = new YtDlpResolver();
    const result = await resolver.resolve("shadow gagan likhari", "123");

    expect(capturedTarget).toBe("ytsearch1:shadow gagan likhari");
    expect(capturedOptions?.noCheckCertificates).toBeUndefined();
    expect(capturedOptions?.extractorArgs).toBe("youtube:player_client=ios,android,mweb;player_skip=webpage");
    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0].title).toBe("Shadow");
    expect(result.tracks[0].author).toBe("Gagan Likhari");
  });

  it("does not treat ytsearch collection wrappers as playlists and leaves playlistName undefined", async () => {
    mockYoutubeDl.mockResolvedValue({
      _type: "playlist",
      id: "ytsearch1:skethcers driprreprot",
      title: "skethcers driprreprot",
      entries: [
        {
          id: "sk123",
          title: "DripReport - Skechers (Official Music Video)",
          uploader: "DripReport",
          duration: 140,
          webpage_url: "https://www.youtube.com/watch?v=sk123",
          thumbnail: "https://i.ytimg.com/vi/sk123/default.jpg",
        },
      ],
    });

    const resolver = new YtDlpResolver();
    const result = await resolver.resolve("skethcers driprreprot", "user456");

    expect(result.playlistName).toBeUndefined();
    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0].title).toBe("DripReport - Skechers (Official Music Video)");
    expect(result.tracks[0].author).toBe("DripReport");
  });

  it("correctly identifies multi-track playlist URLs and sets playlistName", async () => {
    mockYoutubeDl.mockResolvedValue({
      _type: "playlist",
      playlist_title: "Top Hits",
      entries: [
        {
          id: "t1",
          title: "Song 1",
          uploader: "Artist 1",
          duration: 200,
          webpage_url: "https://www.youtube.com/watch?v=t1",
        },
        {
          id: "t2",
          title: "Song 2",
          uploader: "Artist 2",
          duration: 180,
          webpage_url: "https://www.youtube.com/watch?v=t2",
        },
      ],
    });

    const resolver = new YtDlpResolver();
    const result = await resolver.resolve("https://www.youtube.com/playlist?list=PL123", "user456");

    expect(result.playlistName).toBe("Top Hits");
    expect(result.tracks).toHaveLength(2);
    expect(result.tracks[0].title).toBe("Song 1");
    expect(result.tracks[1].title).toBe("Song 2");
  });

  it("treats single-track URLs as single tracks without playlistName", async () => {
    mockYoutubeDl.mockResolvedValue({
      id: "solo1",
      title: "Solo Track",
      uploader: "Solo Artist",
      duration: 150,
      webpage_url: "https://www.youtube.com/watch?v=solo1",
    });

    const resolver = new YtDlpResolver();
    const result = await resolver.resolve("https://www.youtube.com/watch?v=solo1", "user456");

    expect(result.playlistName).toBeUndefined();
    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0].title).toBe("Solo Track");
  });

  it("allows tracks up to 24 hours such as 12-hour videos", async () => {
    mockYoutubeDl.mockResolvedValue({
      id: "12hours",
      title: "Azan 12 hours",
      uploader: "Faith",
      duration: 43200,
      webpage_url: "https://www.youtube.com/watch?v=12hours",
    });

    const resolver = new YtDlpResolver();
    const result = await resolver.resolve("https://www.youtube.com/watch?v=12hours", "123");
    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0].durationMs).toBe(43_200_000);
  });

  it("throws clear error when track exceeds 24-hour duration limit", async () => {
    mockYoutubeDl.mockResolvedValue({
      id: "25hours",
      title: "Very Long Stream",
      uploader: "Streamer",
      duration: 25 * 3600,
      webpage_url: "https://www.youtube.com/watch?v=25hours",
    });

    const resolver = new YtDlpResolver();
    await expect(resolver.resolve("https://www.youtube.com/watch?v=25hours", "123"))
      .rejects.toThrow("exceeds the maximum duration limit of 24 hours");
  });
});

describe("formatMusicError", () => {
  it("formats aborted or state entry errors to helpful message instead of raw AbortError", () => {
    expect(formatMusicError(new Error("The operation was aborted"))).toBe(
      "Connection to the voice channel timed out or was aborted. Please check that the channel is accessible and not full."
    );
    expect(formatMusicError(new Error("failed to enter state Ready"))).toBe(
      "Connection to the voice channel timed out or was aborted. Please check that the channel is accessible and not full."
    );
  });

  it("formats known streaming / YouTube errors", () => {
    expect(formatMusicError(new Error("Sign in to confirm you're not a bot"))).toContain("bot verification");
    expect(formatMusicError(new Error("Sign in to confirm your age"))).toContain("age-restricted");
    expect(formatMusicError(new Error("Video unavailable"))).toContain("unavailable or private");
    expect(formatMusicError(new Error("Geo-restricted"))).toContain("region-restricted");
    expect(formatMusicError(new Error("No playable tracks"))).toContain("No playable tracks were found.");
  });

  it("cleans raw error strings by stripping prefixes", () => {
    expect(formatMusicError(new Error("ERROR: [youtube] something bad happened"))).toBe("something bad happened");
  });
});

describe("voice channel validation", () => {
  function createMockContext(options: {
    channelId?: string | null;
    channelName?: string;
    userLimit?: number;
    memberCount?: number;
    botInChannel?: boolean;
    botPermissions?: bigint[];
    hasGuild?: boolean;
    hasMember?: boolean;
  }) {
    const channelId = options.channelId === undefined ? "vc-123" : options.channelId;
    const channelName = options.channelName ?? "General";
    const userLimit = options.userLimit ?? 0;
    const memberCount = options.memberCount ?? 1;
    const botInChannel = options.botInChannel ?? false;

    const permissions = new PermissionsBitField(
      options.botPermissions ?? [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.Speak,
      ]
    );

    const members = new Collection<string, unknown>();
    for (let i = 0; i < memberCount; i++) {
      members.set(`user-${i}`, { id: `user-${i}` });
    }
    if (botInChannel) {
      members.set("bot-id", { id: "bot-id" });
    }

    const channel = channelId
      ? {
          id: channelId,
          name: channelName,
          isVoiceBased: () => true,
          userLimit,
          members,
          permissionsFor: vi.fn().mockReturnValue(permissions),
        }
      : null;

    const channelsCache = new Map<string, unknown>();
    if (channel) channelsCache.set(channelId!, channel);

    return {
      guild: options.hasGuild === false ? null : {
        id: "guild-1",
        channels: { cache: channelsCache },
        members: {
          me: { id: "bot-id" },
          cache: new Map([["bot-id", { id: "bot-id" }]]),
        },
      },
      member: options.hasMember === false ? null : {
        voice: {
          channelId,
          channel,
        },
      },
      client: {
        user: { id: "bot-id" },
      },
    } as any;
  }

  it("throws when member is not in a voice channel", () => {
    const ctx = createMockContext({ channelId: null });
    expect(() => requireVoiceChannel(ctx)).toThrow("Join a voice channel before using this command.");
  });

  it("throws when channel is full and bot lacks bypass permission", () => {
    const ctx = createMockContext({
      channelName: "Gaming Lounge",
      userLimit: 3,
      memberCount: 3,
      botInChannel: false,
      botPermissions: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.Speak,
      ],
    });

    expect(() => requireVoiceChannel(ctx, { checkJoinable: true })).toThrow(
      "Cannot join Gaming Lounge because it is full (3/3 members)."
    );
  });

  it("allows joining a full channel if bot has MoveMembers permission", () => {
    const ctx = createMockContext({
      channelName: "Gaming Lounge",
      userLimit: 3,
      memberCount: 3,
      botInChannel: false,
      botPermissions: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.Speak,
        PermissionFlagsBits.MoveMembers,
      ],
    });

    expect(requireVoiceChannel(ctx, { checkJoinable: true })).toBe("vc-123");
  });

  it("allows joining a full channel if bot has Administrator permission", () => {
    const ctx = createMockContext({
      channelName: "Gaming Lounge",
      userLimit: 2,
      memberCount: 2,
      botInChannel: false,
      botPermissions: [
        PermissionFlagsBits.Administrator,
      ],
    });

    expect(requireVoiceChannel(ctx, { checkJoinable: true })).toBe("vc-123");
  });

  it("allows joining if bot is already in the channel", () => {
    const ctx = createMockContext({
      channelName: "Gaming Lounge",
      userLimit: 3,
      memberCount: 3,
      botInChannel: true,
      botPermissions: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.Speak,
      ],
    });

    expect(requireVoiceChannel(ctx, { checkJoinable: true })).toBe("vc-123");
  });

  it("throws when bot lacks ViewChannel permission", () => {
    const ctx = createMockContext({
      channelName: "Private VC",
      botPermissions: [PermissionFlagsBits.Connect, PermissionFlagsBits.Speak],
    });

    expect(() => requireVoiceChannel(ctx, { checkJoinable: true })).toThrow(
      "I do not have permission to view your voice channel (Private VC)."
    );
  });

  it("throws when bot lacks Connect permission", () => {
    const ctx = createMockContext({
      channelName: "Restricted VC",
      botPermissions: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Speak],
    });

    expect(() => requireVoiceChannel(ctx, { checkJoinable: true })).toThrow(
      "I do not have permission to join your voice channel (Restricted VC) (missing 'Connect' permission)."
    );
  });

  it("throws when bot lacks Speak permission", () => {
    const ctx = createMockContext({
      channelName: "Muted VC",
      botPermissions: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect],
    });

    expect(() => requireVoiceChannel(ctx, { checkJoinable: true })).toThrow(
      "I do not have permission to speak in your voice channel (Muted VC) (missing 'Speak' permission)."
    );
  });
});

