ALTER TABLE `file_changes` ADD `solution_id` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `jobs` ADD `multi_solution` integer DEFAULT false NOT NULL;