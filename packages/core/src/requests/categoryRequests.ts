import { z } from 'zod';
import { CategoryId, ProfileId, SubCategoryId } from '../domain/shared/ids.ts';
import type {
    CreateCategoryCommand,
    CreateSubCategoryCommand,
    DeleteCategoryCommand,
    RenameCategoryCommand,
    RenameSubCategoryCommand,
} from '../services/category/CategoryCommands.ts';
import { parsedText, registryNameField } from './fields.ts';

export const categoryTreeRequest = z.strictObject({ profileId: parsedText(ProfileId) });

export const createCategoryRequest = z
    .strictObject({ profileId: parsedText(ProfileId), name: registryNameField })
    .transform((data): CreateCategoryCommand => ({ profileId: data.profileId, name: data.name }));

export const renameCategoryRequest = z
    .strictObject({ id: parsedText(CategoryId), name: registryNameField })
    .transform((data): RenameCategoryCommand => ({ id: data.id, name: data.name }));

/** `moveTo` ausente vale para categoria sem lançamentos; com lançamentos, o Service o exige. */
export const deleteCategoryRequest = z
    .strictObject({ id: parsedText(CategoryId), moveTo: parsedText(SubCategoryId).nullable().default(null) })
    .transform((data): DeleteCategoryCommand<CategoryId> => ({ id: data.id, moveTo: data.moveTo }));

export const createSubCategoryRequest = z
    .strictObject({ categoryId: parsedText(CategoryId), name: registryNameField })
    .transform((data): CreateSubCategoryCommand => ({ categoryId: data.categoryId, name: data.name }));

export const renameSubCategoryRequest = z
    .strictObject({ id: parsedText(SubCategoryId), name: registryNameField })
    .transform((data): RenameSubCategoryCommand => ({ id: data.id, name: data.name }));

export const deleteSubCategoryRequest = z
    .strictObject({ id: parsedText(SubCategoryId), moveTo: parsedText(SubCategoryId).nullable().default(null) })
    .transform((data): DeleteCategoryCommand<SubCategoryId> => ({ id: data.id, moveTo: data.moveTo }));
