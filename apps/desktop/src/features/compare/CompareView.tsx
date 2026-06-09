import { useNavigate, useSearchParams } from "react-router-dom";

import type { CompareEntityType } from "@contracts";
import { CompareSurface } from "./CompareSurface";

export const CompareView = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedType = searchParams.get("type") as CompareEntityType | null;

  return <CompareSurface onBack={() => navigate(-1)} requestedType={requestedType} />;
};
