import express from "express";
import { searchQuestion, rewriteUserQuestion, getCaseFullAnswer } from "../controllers/queryController.js";

const router = express.Router();

router.post("/", searchQuestion);
router.post("/rewrite", rewriteUserQuestion);
router.post("/full-answer", getCaseFullAnswer);

export default router;
