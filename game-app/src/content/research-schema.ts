import { z } from 'zod';

export const provenance = z.enum(['VERIFIED', 'RECONSTRUCTED', 'INFERRED', 'RESTORATION']);
export const confidence = z.enum(['HIGH', 'MEDIUM', 'LOW']);
const nonempty = z.string().min(1);
export const sourceNoteSchema = z.object({ sourceId: nonempty, section: nonempty, proves: nonempty }).strict();
export const evidenceShape = { provenance, confidence, sourceNotes: z.array(sourceNoteSchema).min(1) };
const jsonValue: z.ZodType<unknown> = z.lazy(() => z.union([
  z.string(), z.number().finite(), z.boolean(), z.null(), z.array(jsonValue), z.record(jsonValue),
]));
export const claimSchema = z.object({ field: nonempty, value: jsonValue, ...evidenceShape }).strict();
export const nameSchema = z.object({ koOriginal: nonempty.nullable(), en: nonempty }).strict();
export const sourceSchema = z.object({
  id: nonempty, title: nonempty, url: z.string().url().nullable(), domain: nonempty,
  family: nonempty, type: z.enum(['USER_BRIEF', 'HISTORICAL_WIKI', 'PUBLISHER', 'OFFICIAL_ARCHIVE', 'RETROSPECTIVE', 'CONTEMPORARY_PLAYER']),
  accessedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), accessStatus: z.enum(['READ', 'UNAVAILABLE']),
  proves: nonempty, limitations: nonempty,
}).strict();
export const researchRecordSchema = z.object({
  id: nonempty, kind: z.enum(['npc', 'map', 'pet', 'spell', 'monster', 'item']), name: nameSchema,
  ...evidenceShape, claims: z.array(claimSchema), unknowns: z.array(nonempty),
  assetIds: z.array(nonempty), relatedIds: z.array(nonempty), runtimeReady: z.literal(false),
}).strict();
export const missionSchema = z.object({
  id: nonempty, kind: z.enum(['mainMission', 'freeMission']), episodeNumber: z.number().int().min(0).max(102).nullable(),
  name: nameSchema, suppliedKoTitle: nonempty,
  titleVariants: z.array(z.object({ sourceId: nonempty, text: nonempty }).strict()).min(1),
  ...evidenceShape, titleAgreement: z.enum(['WHITESPACE_ONLY_OR_EXACT', 'VARIANT', 'CATALOG_MATCH']),
  walkthroughFound: z.boolean(),
  screenshotsFound: z.enum(['ILLUSTRATIONS_PRESENT_UNCLASSIFIED', 'IMAGE_REFERENCES_UNCLASSIFIED', 'VISUALLY_INSPECTED_CROPS', 'UNKNOWN']),
  questStepsReconstructed: z.boolean(),
  milestones: z.object({ cataloged: z.boolean(), researched: z.boolean(), scripted: z.boolean(), playable: z.boolean(), verified: z.boolean() }).strict(),
  implementationStatus: z.enum(['CATALOGED', 'RESEARCHED', 'SCRIPTED', 'PLAYABLE', 'VERIFIED']),
  claims: z.array(claimSchema), unknowns: z.array(nonempty),
  rewards: z.object({ exp: z.number().int().nonnegative().nullable(), pin: z.number().int().nonnegative().nullable(), virtuePoints: z.number().int().nonnegative().nullable(), items: z.array(nonempty).nullable(), pets: z.array(nonempty).nullable() }).strict(),
  runtimeDefinitionId: nonempty.nullable(),
}).strict().superRefine((m, ctx) => {
  if ((m.kind === 'mainMission') !== (m.episodeNumber !== null)) ctx.addIssue({ code: 'custom', message: 'Only main missions have episode numbers' });
  const levels = ['cataloged', 'researched', 'scripted', 'playable', 'verified'] as const;
  let gap = false;
  for (const stage of levels) {
    if (!m.milestones[stage]) gap = true;
    else if (gap) ctx.addIssue({ code: 'custom', message: `Cannot skip a milestone before ${stage}` });
  }
  const highest = [...levels].reverse().find(s => m.milestones[s]);
  if (highest?.toUpperCase() !== m.implementationStatus) ctx.addIssue({ code: 'custom', message: 'Status disagrees with milestones' });
  if (m.milestones.scripted && (!m.runtimeDefinitionId || !m.questStepsReconstructed)) ctx.addIssue({ code: 'custom', message: 'Scripted missions require reconstructed steps and a runtime definition' });
  if (m.milestones.verified && m.unknowns.length) ctx.addIssue({ code: 'custom', message: 'Verified mission still has unresolved fields' });
});
export type ResearchMission = z.infer<typeof missionSchema>;
