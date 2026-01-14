import React, { useRef, useState, useMemo, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Environment, Float, PresentationControls, useCursor, useTexture } from '@react-three/drei';
import * as THREE from 'three';

// Configuration
// Using BoxGeometry for now to GUARANTEE texture visibility.
// RoundedBox UVs are notoriously problematic for single-face mapping without adjustment.
const PAGE_WIDTH = 3;
const PAGE_HEIGHT = 4.2;
const PAGE_DEPTH = 0.02; // Very thin
const ROUGHNESS = 0.2;

interface PageProps {
    number: number;
    opened: boolean;
    totalPages: number;
    coverTexture?: THREE.Texture;
    spreadLeft?: THREE.Texture;
    spreadRight?: THREE.Texture;
}

function Page({ number, opened, totalPages, coverTexture, spreadLeft, spreadRight }: PageProps) {
    const group = useRef<THREE.Group>(null);

    useFrame((_, delta) => {
        if (!group.current) return;

        const targetRotation = opened ? -Math.PI : 0;
        const rotDiff = targetRotation - group.current.rotation.y;
        group.current.rotation.y += rotDiff * delta * 5;

        const progress = Math.max(0, Math.min(1, -group.current.rotation.y / Math.PI));
        const spacing = 0.01;
        const closedZ = (totalPages - number) * spacing;
        const openedZ = number * spacing;

        const lift = Math.sin(progress * Math.PI) * 1.0;

        group.current.position.z = THREE.MathUtils.lerp(closedZ, openedZ, progress) + lift;
    });

    const isCover = number === 0;
    const isFirstPage = number === 1;

    // Define materials array for BoxGeometry
    // Order: Right, Left, Top, Bottom, Front, Back
    const materialArray = useMemo(() => {
        const sideColor = '#f5f5f5';
        const sideMat = new THREE.MeshStandardMaterial({ color: sideColor, roughness: 0.5 });

        // 4: FRONT
        let frontMat;
        if (isCover && coverTexture) {
            frontMat = new THREE.MeshStandardMaterial({
                map: coverTexture,
                roughness: 0.2,
                color: '#ffffff' // Ensure tint is white
            });
        } else if (isFirstPage && spreadRight) {
            frontMat = new THREE.MeshStandardMaterial({
                map: spreadRight,
                roughness: 0.2,
                color: '#ffffff'
            });
        } else {
            // Inner pages pastel
            const pastels = ['#FF9A9E', '#FECFEF', '#A18CD1', '#FBC2EB', '#8FD3F4', '#84FAB0'];
            frontMat = new THREE.MeshStandardMaterial({
                color: pastels[number % pastels.length],
                roughness: ROUGHNESS
            });
        }

        // 5: BACK
        let backMat;
        if (isCover && spreadLeft) {
            backMat = new THREE.MeshStandardMaterial({
                map: spreadLeft,
                roughness: 0.2,
                color: '#ffffff'
            });
        } else {
            backMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: ROUGHNESS });
        }

        return [sideMat, sideMat, sideMat, sideMat, frontMat, backMat];
    }, [isCover, isFirstPage, coverTexture, spreadLeft, spreadRight, number]);


    return (
        <group ref={group}>
            <group position={[PAGE_WIDTH / 2, 0, 0]}>
                {/* Standard BoxGeometry has correct UVs for direct mapping */}
                <mesh material={materialArray}>
                    <boxGeometry args={[PAGE_WIDTH, PAGE_HEIGHT, PAGE_DEPTH]} />
                </mesh>
            </group>
        </group>
    );
}

const Book = ({ setTotalPages, setCurrentPage }: { setTotalPages: (n: number) => void, setCurrentPage: (n: number) => void }) => {
    const totalPages = 6;
    const [pageIndex, setPageIndex] = useState(0);
    const [hovered, setHover] = useState(false);
    useCursor(hovered);

    const coverTexture = useTexture('/book_cover.png');
    coverTexture.colorSpace = THREE.SRGBColorSpace;

    // Spread texture handling
    const spreadTexture = useTexture('/book_spread.png');
    spreadTexture.colorSpace = THREE.SRGBColorSpace;

    const [spreadLeft, spreadRight] = useMemo(() => {
        const left = spreadTexture.clone();
        left.colorSpace = THREE.SRGBColorSpace;
        left.offset.set(0, 0);
        left.repeat.set(0.5, 1);
        left.needsUpdate = true;

        const right = spreadTexture.clone();
        right.colorSpace = THREE.SRGBColorSpace;
        right.offset.set(0.5, 0);
        right.repeat.set(0.5, 1);
        right.needsUpdate = true;

        return [left, right];
    }, [spreadTexture]);

    const pages = useMemo(() => new Array(totalPages).fill(0).map((_, i) => i), [totalPages]);

    const next = (e: any) => {
        e.stopPropagation();
        setPageIndex(prev => (prev < totalPages ? prev + 1 : 0));
    };

    useEffect(() => {
        setTotalPages(totalPages);
        setCurrentPage(pageIndex);
    }, [pageIndex, totalPages]);

    return (
        <group
            onPointerOver={(e) => { e.stopPropagation(); setHover(true); }}
            onPointerOut={(e) => { e.stopPropagation(); setHover(false); }}
            onClick={next}
        >
            {pages.map((i) => (
                <Page
                    key={i}
                    number={i}
                    totalPages={totalPages}
                    opened={i < pageIndex}
                    coverTexture={i === 0 ? coverTexture : undefined}
                    spreadLeft={i === 0 ? spreadLeft : undefined}
                    spreadRight={i === 1 ? spreadRight : undefined}
                />
            ))}
        </group>
    );
};

export default function BookDemo({ onBack }: { onBack: () => void }) {
    const [totalPages, setTotalPages] = useState(0);
    const [currentPage, setCurrentPage] = useState(0);

    return (
        <div className="w-full h-screen bg-slate-50 relative overflow-hidden font-sans">
            {/* Background stays same */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] bg-indigo-200/20 rounded-full blur-3xl" />
                <div className="absolute top-[40%] -right-[10%] w-[40%] h-[60%] bg-blue-200/20 rounded-full blur-3xl" />
            </div>

            <button
                onClick={onBack}
                className="absolute top-8 left-8 z-50 text-slate-500 hover:text-slate-900 transition-colors flex items-center gap-2 font-medium"
            >
                ← Back
            </button>

            <div className="absolute bottom-12 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-white/50 backdrop-blur-md px-6 py-3 rounded-full shadow-sm border border-white/50 transition-all duration-300">
                {new Array(totalPages + 1).fill(0).map((_, i) => (
                    <div
                        key={i}
                        className={`
                            rounded-full transition-all duration-300
                            ${i === currentPage
                                ? 'w-3 h-3 bg-indigo-600 scale-110'
                                : 'w-2 h-2 bg-slate-300 hover:bg-slate-400'
                            }
                        `}
                    />
                ))}
            </div>

            <Canvas shadows camera={{ position: [0, 0, 8.5], fov: 35 }}>
                <ambientLight intensity={1.5} />
                <pointLight position={[-10, 0, 10]} intensity={0.5} />
                <spotLight position={[5, 10, 5]} angle={0.4} penumbra={0.5} intensity={1} castShadow />

                <PresentationControls
                    global
                    rotation={[0, 0, 0]}
                    polar={[-Math.PI / 8, Math.PI / 8]}
                    azimuth={[-Math.PI / 8, Math.PI / 8]}
                >
                    <Float
                        rotationIntensity={0.2}
                        floatIntensity={0.2}
                        speed={2}
                        floatingRange={[-0.1, 0.1]}
                    >
                        <React.Suspense fallback={null}>
                            <Book setTotalPages={setTotalPages} setCurrentPage={setCurrentPage} />
                        </React.Suspense>
                    </Float>
                </PresentationControls>

                <Environment preset="city" />
            </Canvas>
        </div>
    );
}
