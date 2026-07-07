export type PasswordRequirementKey = "minLength" | "lowercase" | "uppercase" | "number" | "symbol";

export type PasswordRequirementStatus = {
  key: PasswordRequirementKey;
  met: boolean;
};

export const passwordPolicy = {
  minLength: 6,
  requiredKeys: ["minLength", "lowercase", "uppercase", "number", "symbol"] as PasswordRequirementKey[],
};

export const getPasswordRequirementStatus = (password: string): PasswordRequirementStatus[] => [
  {
    key: "minLength",
    met: password.length >= passwordPolicy.minLength,
  },
  {
    key: "lowercase",
    met: /[a-z]/.test(password),
  },
  {
    key: "uppercase",
    met: /[A-Z]/.test(password),
  },
  {
    key: "number",
    met: /\d/.test(password),
  },
  {
    key: "symbol",
    met: /[^A-Za-z0-9]/.test(password),
  },
];

export const isPasswordPolicySatisfied = (password: string) =>
  getPasswordRequirementStatus(password).every((requirement) => requirement.met);
