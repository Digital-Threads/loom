import React from "react";
import { Box, Text } from "ink";

export function Tabs({ tabs, active }: { tabs: string[]; active: number }) {
  return (
    <Box>
      {tabs.map((t, i) => (
        <Box key={t} marginRight={2}>
          <Text inverse={i === active} bold={i === active}>{` ${t} `}</Text>
        </Box>
      ))}
    </Box>
  );
}
