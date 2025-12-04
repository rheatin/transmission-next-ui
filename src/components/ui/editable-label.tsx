import * as React from "react";
import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface EditableLabelProps {
    value: number;
    onChange: (value: number) => void;
}

export function EditableLabel({ value, onChange }: EditableLabelProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [currentValue, setCurrentValue] = useState(value);

    useEffect(() => {
        setCurrentValue(value);
    }, [value]);

    const handleLabelClick = () => {
        setIsEditing(true);
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setCurrentValue(Number(e.target.value));
    };

    const handleInputBlur = () => {
        setIsEditing(false);
        if (currentValue >= 1) {
            onChange(currentValue);
        } else {
            setCurrentValue(value); // Revert to original value if less than 1
        }
    };

    const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
            handleInputBlur();
        }
    };

    if (isEditing) {
        return (
            <Input
                type="number"
                value={currentValue}
                onChange={handleInputChange}
                onBlur={handleInputBlur}
                onKeyPress={handleKeyPress}
                autoFocus
                className="w-20"
            />
        );
    }

    return (
        <Label onClick={handleLabelClick} className="cursor-pointer">
            {value}s
        </Label>
    );
}