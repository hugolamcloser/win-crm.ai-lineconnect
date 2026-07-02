import express from "express";
import type { RawBodyRequest } from "../types/http";

export const jsonBodyParser = express.json({
  limit: "2mb",
  verify: (req, _res, buffer) => {
    (req as RawBodyRequest).rawBody = Buffer.from(buffer);
  }
});
