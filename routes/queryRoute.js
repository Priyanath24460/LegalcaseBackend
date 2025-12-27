import express from "express";
import { searchQuestion } from "../controllers/queryController.js";

const router = express.Router();

router.post("/", searchQuestion);

export default router;
