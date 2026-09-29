import { listCategories } from '../models/categoryModel.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendData } from '../utils/http.js';

/** GET /api/categories - drives the category chips and the browse filter. */
export const list = asyncHandler(async (_req, res) => {
  const categories = await listCategories();
  return sendData(res, categories);
});
