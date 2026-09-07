/** Narrow, reviewed registration profiles. Unknown courses are not inferred. */
export const componentPolicies = {
  EE109: { types: ["Lecture", "Lab", "Quiz"], program: "ENGV/EE" },
  CSCI426: { types: ["Lecture"], program: "ENGV/CSCI" },
  SSCI165: { types: ["Lecture", "Lab"], program: "DRNS/SSCI" },
} as const;
export const componentPolicyTerm = 20263;
export const componentPolicyEvidence = {
  policy_version: "usc-unlinked-components-20263-v1",
  verified_on: "2026-09-06",
  sources: [
    {
      title: "USC component selection guide",
      url: "https://academicprograms.usc.edu/wp-content/uploads/2025/08/AEA-Navigation-Guides-Course-Types.pdf",
    },
    {
      title: "USC link-code reference (2011), page 12",
      url: "https://itservices.usc.edu/files/2013/11/3.RNR_.U.SCHEDULE_2011JULY.pdf",
    },
  ],
};
