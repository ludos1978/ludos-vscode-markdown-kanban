#!/usr/bin/env python3

import os, subprocess, re, sys
from pathlib import Path
import argparse
import datetime
import shutil


class MarpConverter:
		def __init__(self, output_format, additional_parameters=None, filename_addon=""):
				"""Initialize the converter with specified output format"""
				self.program_name = 'marp'
				self.program_path = shutil.which(self.program_name)
				self.output_format = output_format
				self.additional_parameters = additional_parameters
				self.filename_addon = filename_addon
				self.current_working_directory = Path('.').absolute()
				self.relative_export_path = Path(f"_Export_{self.output_format.upper()}")
				
				# marp paths and parameters
				self.marppresenterpath = "/Users/rspoerri/_SYNC/_SYSTEM/_MarpEngine"
				self.engine_parameter = f"{self.marppresenterpath}/engine.js"
				self.theme_parameter = f"{self.marppresenterpath}/themes/"
				
				# Ensure export directory exists
				self._ensure_export_directory()
		
		def _ensure_export_directory(self):
				"""Create the export directory if it doesn't exist"""
				if self.relative_export_path.exists():
						if not self.relative_export_path.is_dir():
								print(f"Export path blocked by file {self.relative_export_path}")
				else:
						self.relative_export_path.mkdir(parents=True, exist_ok=True)
		
		def convert_files(self, input_filenames):
				"""Convert all specified input files"""
				print(f"Converting {len(input_filenames)} files to {self.output_format}")
				
				for input_filename in input_filenames:
						self.convert_file(input_filename)
		
		def convert_file(self, input_filename):
				"""Convert a single file to the specified format"""
				document_filename = Path(input_filename).absolute()
				relative_working_directory = document_filename.parent.relative_to(self.current_working_directory)
				
				timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M")
				input_file = document_filename.name
				output_filename = self.relative_export_path / Path(f"{document_filename.stem}{self.filename_addon}-{timestamp}.{self.output_format}")
				
				print(f"Converting: {datetime.datetime.now()}")
				print(f"				file path: ./{str(relative_working_directory)}/")
				
				input_filepath = relative_working_directory / input_file
				output_filepath = relative_working_directory / output_filename
				print(f"   input_filepath: {str(input_filepath)}")
				print(f"  output_filepath: {str(output_filepath)}")
				
				# Build the parameters for the conversion
				parameters = self._build_parameters(input_file, output_filepath)
				
				# Run the conversion
				result = subprocess.run(parameters, cwd=relative_working_directory)
				
				if True:  # Debug information
						print(f"Executing command: {' '.join(parameters)}")
						print(f"						  cwd: {relative_working_directory}")
						print(f'args: \n{result.args}')
						print(f'Output: \n{result.stdout}')
						print(f'Error: \n{result.stderr}')
		
		def _build_parameters(self, input_filename, output_filepath):
				"""Build the parameters for the marp command"""
				parameters = [
						f'{self.program_path}',
						f'{input_filename}',
						'--allow-local-files',
						f'--{self.output_format}',
						'--theme-set', f'{self.theme_parameter}',
						'--engine', f'{self.engine_parameter}',
						'-o', f'{output_filepath}',
				]
				if (self.additional_parameters):
						parameters += self.additional_parameters
				return parameters


def main():
		parser = argparse.ArgumentParser(description='Convert Markdown to various formats using Marp')
		parser.add_argument('files', nargs='+', help='files to convert')
		parser.add_argument('--format', choices=['pdf', 'pptx'], default='pdf', help='output format (pdf or pptx)')
		
		args = parser.parse_args()
		
		converter = MarpConverter(args.format)
		converter.convert_files(args.files)


if __name__ == "__main__":
		main()
