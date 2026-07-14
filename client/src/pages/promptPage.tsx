import React from "react";
import Promptbox from "../components/promptbox";

const PromptPage: React.FC = () => {
  return (
    <>
      {/* Main UI: Centered horizontally, top edge aligned with screen vertical center */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 z-10 w-full flex justify-center pointer-events-none">
        <div className="w-full flex justify-center pointer-events-auto">
          <Promptbox />
        </div>
      </div>
    </>
  );
};

export default PromptPage;
